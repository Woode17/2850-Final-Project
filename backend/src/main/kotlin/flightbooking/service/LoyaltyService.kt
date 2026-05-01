package flightbooking.service

import flightbooking.db.table.BookingsTable
import flightbooking.db.table.LoyaltyAccountsTable
import flightbooking.db.table.LoyaltyRedemptionsTable
import flightbooking.db.table.LoyaltyRewardsTable
import flightbooking.db.table.LoyaltyTransactionsTable
import flightbooking.db.table.UsersTable
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonIgnoreUnknownKeys
import org.jetbrains.exposed.sql.ResultRow
import org.jetbrains.exposed.sql.insert
import org.jetbrains.exposed.sql.selectAll
import org.jetbrains.exposed.sql.transactions.transaction
import org.jetbrains.exposed.sql.update
import java.time.LocalDateTime
import java.util.UUID
import kotlin.math.floor

object LoyaltyService {
    private val json = Json {
        ignoreUnknownKeys = true
    }

    private const val defaultUserId = 1
    private const val silverThreshold = 2000
    private const val goldThreshold = 5000
    private const val firstBookingBonus = 500

    @OptIn(ExperimentalSerializationApi::class)
    @Serializable
    @JsonIgnoreUnknownKeys
    data class RedeemRequest(
        val rewardId: String = "",
        val pointsCost: Int = 0,
    )

    @Serializable
    data class LoyaltyReward(
        val id: String,
        val name: String,
        val description: String,
        val pointsCost: Int,
        val benefitType: String,
        val benefitValue: String? = null,
        val tierRequired: String,
        val active: Boolean,
        val affordable: Boolean,
        val unlocked: Boolean,
    )

    @Serializable
    data class RedeemedBenefit(
        val id: Int,
        val rewardId: String,
        val rewardName: String,
        val benefitType: String,
        val benefitValue: String? = null,
        val status: String,
        val redemptionCode: String,
        val message: String,
        val redeemedAt: String,
        val expiresAt: String? = null,
    )

    @Serializable
    data class LoyaltySummary(
        val userId: Int,
        val points: Int,
        val lifetimePoints: Int,
        val tier: String,
        val nextTier: String? = null,
        val pointsToNextTier: Int = 0,
        val rewards: List<LoyaltyReward> = emptyList(),
        val benefits: List<RedeemedBenefit> = emptyList(),
    )

    @Serializable
    data class RedeemResponse(
        val rewardId: String,
        val rewardName: String,
        val points: Int,
        val lifetimePoints: Int,
        val tier: String,
        val benefit: RedeemedBenefit,
        val message: String,
    )

    @Serializable
    data class PointsAward(
        val pointsEarned: Int,
        val bonusPoints: Int,
        val newBalance: Int,
        val tier: String,
    )

    fun getLoyalty(authorizationHeader: String?): LoyaltySummary = transaction {
        ensureRewardCatalog()
        val userId = resolveUserId(authorizationHeader)
        val accountRow = ensureAccount(userId)
        buildSummary(userId, accountRow)
    }

    fun redeem(authorizationHeader: String?, requestBody: String): RedeemResponse = transaction {
        ensureRewardCatalog()
        val request = json.decodeFromString<RedeemRequest>(requestBody)
        val rewardCode = request.rewardId.trim()
        require(rewardCode.isNotBlank()) { "Reward id is required" }

        val userId = resolveUserId(authorizationHeader)
        val accountRow = ensureAccount(userId)
        val rewardRow = LoyaltyRewardsTable.selectAll()
            .firstOrNull { it[LoyaltyRewardsTable.rewardCode] == rewardCode && it[LoyaltyRewardsTable.isActive] }
            ?: throw IllegalArgumentException("Reward not found")

        val currentTier = accountRow[LoyaltyAccountsTable.tier]
        val currentPoints = accountRow[LoyaltyAccountsTable.pointsBalance]
        val rewardCost = rewardRow[LoyaltyRewardsTable.pointsCost]
        val tierRequired = rewardRow[LoyaltyRewardsTable.tierRequired]
        if (request.pointsCost > 0 && request.pointsCost != rewardCost) {
            throw IllegalArgumentException("Reward cost is out of date. Refresh and try again.")
        }

        if (!tierMeetsRequirement(currentTier, tierRequired)) {
            throw IllegalArgumentException("This reward requires ${tierRequired.replaceFirstChar { it.uppercase() }} tier")
        }
        if (currentPoints < rewardCost) {
            throw IllegalArgumentException("Not enough points")
        }

        val accountId = accountRow[LoyaltyAccountsTable.id]
        val updatedPoints = currentPoints - rewardCost
        val updatedTier = calculateTier(lifetimePointsForAccount(accountId))
        val now = LocalDateTime.now()
        val redemptionCode = "LOYALTY-${UUID.randomUUID().toString().replace("-", "").take(10).uppercase()}"
        val expiresAt = now.plusMonths(12)
        val benefitMessage = buildBenefitMessage(
            rewardName = rewardRow[LoyaltyRewardsTable.name],
            benefitValue = rewardRow[LoyaltyRewardsTable.benefitValue],
            redemptionCode = redemptionCode,
            memberId = userId,
        )

        LoyaltyAccountsTable.update({ LoyaltyAccountsTable.id eq accountId }) { row ->
            row[pointsBalance] = updatedPoints
            row[tier] = updatedTier
        }

        LoyaltyTransactionsTable.insert { row ->
            row[loyaltyAccountId] = accountId
            row[bookingId] = null
            row[pointsEarned] = 0
            row[pointsRedeemed] = rewardCost
            row[transactionDate] = now
        }

        val redemptionId = LoyaltyRedemptionsTable.insert { row ->
            row[loyaltyAccountId] = accountId
            row[rewardId] = rewardRow[LoyaltyRewardsTable.id]
            row[pointsSpent] = rewardCost
            row[LoyaltyRedemptionsTable.status] = "active"
            row[LoyaltyRedemptionsTable.redemptionCode] = redemptionCode
            row[LoyaltyRedemptionsTable.benefitDetails] = benefitMessage
            row[LoyaltyRedemptionsTable.redeemedAt] = now
            row[LoyaltyRedemptionsTable.expiresAt] = expiresAt
        }[LoyaltyRedemptionsTable.id]

        val lifetimePoints = lifetimePointsForAccount(accountId)
        val benefit = createRedeemedBenefit(
            redemptionId = redemptionId,
            rewardRow = rewardRow,
            status = "Active",
            redemptionCode = redemptionCode,
            message = benefitMessage,
            redeemedAt = now,
            expiresAt = expiresAt,
        )
        RedeemResponse(
            rewardId = rewardCode,
            rewardName = rewardRow[LoyaltyRewardsTable.name],
            points = updatedPoints,
            lifetimePoints = lifetimePoints,
            tier = updatedTier.replaceFirstChar { it.uppercase() },
            benefit = benefit,
            message = "${rewardRow[LoyaltyRewardsTable.name]} redeemed successfully",
        )
    }

    fun awardPointsForBooking(userId: Int, bookingId: Int, totalPrice: Double, travelClass: String): PointsAward {
        ensureUser(userId)
        ensureRewardCatalog()

        val accountRow = ensureAccount(userId)
        val accountId = accountRow[LoyaltyAccountsTable.id]
        val existingBookingTransaction = LoyaltyTransactionsTable.selectAll()
            .firstOrNull {
                it[LoyaltyTransactionsTable.loyaltyAccountId] == accountId &&
                    it[LoyaltyTransactionsTable.bookingId] == bookingId &&
                    it[LoyaltyTransactionsTable.pointsEarned] > 0
            }

        if (existingBookingTransaction != null) {
            return PointsAward(
                pointsEarned = existingBookingTransaction[LoyaltyTransactionsTable.pointsEarned],
                bonusPoints = 0,
                newBalance = accountRow[LoyaltyAccountsTable.pointsBalance],
                tier = accountRow[LoyaltyAccountsTable.tier].replaceFirstChar { it.uppercase() },
            )
        }

        val basePoints = calculateEarnedPoints(totalPrice = totalPrice, travelClass = travelClass)
        val isFirstBooking = BookingsTable.selectAll().count { row ->
            row[BookingsTable.userId] == userId && row[BookingsTable.status].lowercase() != "cancelled"
        } == 1
        val bonusPoints = if (isFirstBooking) firstBookingBonus else 0
        val totalPointsAwarded = basePoints + bonusPoints
        val updatedBalance = accountRow[LoyaltyAccountsTable.pointsBalance] + totalPointsAwarded
        val updatedTier = calculateTier(lifetimePointsForAccount(accountId) + totalPointsAwarded)

        LoyaltyAccountsTable.update({ LoyaltyAccountsTable.id eq accountId }) { row ->
            row[pointsBalance] = updatedBalance
            row[tier] = updatedTier
        }

        LoyaltyTransactionsTable.insert { row ->
            row[loyaltyAccountId] = accountId
            row[LoyaltyTransactionsTable.bookingId] = bookingId
            row[pointsEarned] = totalPointsAwarded
            row[pointsRedeemed] = 0
            row[transactionDate] = LocalDateTime.now()
        }

        return PointsAward(
            pointsEarned = basePoints,
            bonusPoints = bonusPoints,
            newBalance = updatedBalance,
            tier = updatedTier.replaceFirstChar { it.uppercase() },
        )
    }

    fun estimatePoints(totalPrice: Double, travelClass: String, includeFirstBookingBonus: Boolean): Int {
        val basePoints = calculateEarnedPoints(totalPrice = totalPrice, travelClass = travelClass)
        return basePoints + if (includeFirstBookingBonus) firstBookingBonus else 0
    }

    private fun buildSummary(userId: Int, accountRow: ResultRow): LoyaltySummary {
        val accountId = accountRow[LoyaltyAccountsTable.id]
        val points = accountRow[LoyaltyAccountsTable.pointsBalance]
        val lifetimePoints = lifetimePointsForAccount(accountId)
        val tier = calculateTier(lifetimePoints)
        val rewards = LoyaltyRewardsTable.selectAll()
            .sortedWith(compareBy({ it[LoyaltyRewardsTable.pointsCost] }, { it[LoyaltyRewardsTable.name] }))
            .map { row ->
                val requiredTier = row[LoyaltyRewardsTable.tierRequired]
                LoyaltyReward(
                    id = row[LoyaltyRewardsTable.rewardCode],
                    name = row[LoyaltyRewardsTable.name],
                    description = row[LoyaltyRewardsTable.description],
                    pointsCost = row[LoyaltyRewardsTable.pointsCost],
                    benefitType = row[LoyaltyRewardsTable.benefitType],
                    benefitValue = row[LoyaltyRewardsTable.benefitValue],
                    tierRequired = requiredTier.replaceFirstChar { it.uppercase() },
                    active = row[LoyaltyRewardsTable.isActive],
                    affordable = points >= row[LoyaltyRewardsTable.pointsCost],
                    unlocked = tierMeetsRequirement(tier, requiredTier),
                )
            }
        val benefits = LoyaltyRedemptionsTable.selectAll()
            .filter { it[LoyaltyRedemptionsTable.loyaltyAccountId] == accountId }
            .sortedByDescending { it[LoyaltyRedemptionsTable.redeemedAt] }
            .map { redemption ->
                val rewardRow = LoyaltyRewardsTable.selectAll()
                    .first { it[LoyaltyRewardsTable.id] == redemption[LoyaltyRedemptionsTable.rewardId] }
                redemption.toRedeemedBenefit(rewardRow)
            }

        val nextTier = nextTierFor(tier)
        val pointsToNextTier = when (nextTier) {
            "Silver" -> (silverThreshold - lifetimePoints).coerceAtLeast(0)
            "Gold" -> (goldThreshold - lifetimePoints).coerceAtLeast(0)
            else -> 0
        }

        return LoyaltySummary(
            userId = userId,
            points = points,
            lifetimePoints = lifetimePoints,
            tier = tier.replaceFirstChar { it.uppercase() },
            nextTier = nextTier,
            pointsToNextTier = pointsToNextTier,
            rewards = rewards,
            benefits = benefits,
        )
    }

    private fun ensureRewardCatalog() {
        if (LoyaltyRewardsTable.selectAll().any()) return

        val now = LocalDateTime.now()
        val seedRewards = listOf(
            RewardSeed("voucher_10", "GBP10 Discount Voucher", "Take GBP10 off a future booking.", 500, "voucher", "10", "bronze"),
            RewardSeed("extra_bag", "Free Extra Luggage", "Add one complimentary checked bag to a future trip.", 800, "baggage", "1 extra bag", "bronze"),
            RewardSeed("voucher_25", "GBP25 Discount Voucher", "Take GBP25 off a future booking.", 1200, "voucher", "25", "silver"),
            RewardSeed("seat_upgrade", "Cabin Upgrade", "Upgrade one future segment to the next cabin where available.", 1500, "upgrade", "single segment", "silver"),
            RewardSeed("lounge_pass", "Airport Lounge Pass", "Enjoy one airport lounge visit before departure.", 2000, "lounge", "single use", "gold"),
        )

        seedRewards.forEach { reward ->
            LoyaltyRewardsTable.insert { row ->
                row[rewardCode] = reward.rewardCode
                row[name] = reward.name
                row[description] = reward.description
                row[pointsCost] = reward.pointsCost
                row[benefitType] = reward.benefitType
                row[benefitValue] = reward.benefitValue
                row[tierRequired] = reward.tierRequired
                row[isActive] = true
                row[createdAt] = now
            }
        }
    }

    private fun resolveUserId(authorizationHeader: String?): Int {
        val tokenUserId = AuthService.resolveUserIdFromAuthorization(authorizationHeader)
        val candidate = tokenUserId ?: defaultUserId
        ensureUser(candidate)
        return candidate
    }

    private fun ensureUser(userId: Int) {
        val existing = UsersTable.selectAll().any { it[UsersTable.id] == userId }
        if (existing) return

        UsersTable.insert { row ->
            row[id] = userId
            row[firstName] = "Guest"
            row[lastName] = "User"
            row[email] = "guest$userId@leedsair.local"
            row[passwordHash] = null
            row[role] = "customer"
            row[createdAt] = LocalDateTime.now()
        }
    }

    private fun ensureAccount(userId: Int): ResultRow {
        val existing = LoyaltyAccountsTable.selectAll().firstOrNull { it[LoyaltyAccountsTable.userId] == userId }
        if (existing != null) return existing

        LoyaltyAccountsTable.insert { row ->
            row[LoyaltyAccountsTable.userId] = userId
            row[pointsBalance] = 0
            row[tier] = "bronze"
        }
        return LoyaltyAccountsTable.selectAll().first { it[LoyaltyAccountsTable.userId] == userId }
    }

    private fun lifetimePointsForAccount(accountId: Int): Int =
        LoyaltyTransactionsTable.selectAll()
            .filter { it[LoyaltyTransactionsTable.loyaltyAccountId] == accountId }
            .sumOf { it[LoyaltyTransactionsTable.pointsEarned] }

    private fun calculateEarnedPoints(totalPrice: Double, travelClass: String): Int {
        val multiplier = when (travelClass.trim().lowercase()) {
            "business" -> 2
            else -> 1
        }
        return floor(totalPrice).toInt().coerceAtLeast(0) * multiplier
    }

    private fun calculateTier(points: Int): String = when {
        points >= goldThreshold -> "gold"
        points >= silverThreshold -> "silver"
        else -> "bronze"
    }

    private fun nextTierFor(tier: String): String? = when (tier.lowercase()) {
        "bronze" -> "Silver"
        "silver" -> "Gold"
        else -> null
    }

    private fun tierMeetsRequirement(currentTier: String, requiredTier: String): Boolean =
        tierRank(currentTier) >= tierRank(requiredTier)

    private fun tierRank(tier: String): Int = when (tier.lowercase()) {
        "gold" -> 3
        "silver" -> 2
        else -> 1
    }

    private fun ResultRow.toRedeemedBenefit(rewardRow: ResultRow): RedeemedBenefit =
        createRedeemedBenefit(
            redemptionId = this[LoyaltyRedemptionsTable.id],
            rewardRow = rewardRow,
            status = this[LoyaltyRedemptionsTable.status].replaceFirstChar { it.uppercase() },
            redemptionCode = this[LoyaltyRedemptionsTable.redemptionCode],
            message = this[LoyaltyRedemptionsTable.benefitDetails].orEmpty(),
            redeemedAt = this[LoyaltyRedemptionsTable.redeemedAt],
            expiresAt = this[LoyaltyRedemptionsTable.expiresAt],
        )

    private fun createRedeemedBenefit(
        redemptionId: Int,
        rewardRow: ResultRow,
        status: String,
        redemptionCode: String,
        message: String,
        redeemedAt: LocalDateTime,
        expiresAt: LocalDateTime?,
    ): RedeemedBenefit =
        RedeemedBenefit(
            id = redemptionId,
            rewardId = rewardRow[LoyaltyRewardsTable.rewardCode],
            rewardName = rewardRow[LoyaltyRewardsTable.name],
            benefitType = rewardRow[LoyaltyRewardsTable.benefitType],
            benefitValue = rewardRow[LoyaltyRewardsTable.benefitValue],
            status = status,
            redemptionCode = redemptionCode,
            message = message,
            redeemedAt = redeemedAt.toString(),
            expiresAt = expiresAt?.toString(),
        )

    private fun buildBenefitMessage(rewardName: String, benefitValue: String?, redemptionCode: String, memberId: Int): String {
        val valueText = benefitValue?.let { "Benefit: $it." } ?: ""
        return "$rewardName redeemed for member $memberId. $valueText Use code $redemptionCode before expiry.".trim()
    }

    private data class RewardSeed(
        val rewardCode: String,
        val name: String,
        val description: String,
        val pointsCost: Int,
        val benefitType: String,
        val benefitValue: String?,
        val tierRequired: String,
    )
}
