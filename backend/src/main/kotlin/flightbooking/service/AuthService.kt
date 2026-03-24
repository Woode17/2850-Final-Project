package flightbooking.service

import flightbooking.db.table.LoyaltyAccountsTable
import flightbooking.db.table.UsersTable
import flightbooking.db.AuthResponse
import flightbooking.db.AuthUser
import flightbooking.db.LoginRequest
import flightbooking.db.RegisterRequest
import org.jetbrains.exposed.sql.SqlExpressionBuilder.eq
import org.jetbrains.exposed.sql.and
import org.jetbrains.exposed.sql.insert
import org.jetbrains.exposed.sql.selectAll
import org.jetbrains.exposed.sql.transactions.transaction
import java.security.MessageDigest
import java.time.LocalDateTime
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

object AuthService {
    private val tokenToUserId = ConcurrentHashMap<String, Int>()

    fun register(payload: RegisterRequest): AuthResponse? {
        val email = payload.email.trim().lowercase()
        val user = transaction {
            val existing = UsersTable
                .selectAll()
                .where { UsersTable.email eq email }
                .firstOrNull()

            if (existing != null) return@transaction null

            val userId = UsersTable.insert {
                it[firstName] = payload.firstName.trim().ifBlank { null }
                it[lastName] = payload.lastName.trim().ifBlank { null }
                it[UsersTable.email] = email
                it[passwordHash] = sha256(payload.password)
                it[role] = "customer"
                it[createdAt] = LocalDateTime.now()
            }[UsersTable.id]

            LoyaltyAccountsTable.insert {
                it[LoyaltyAccountsTable.userId] = userId
                it[pointsBalance] = 0
                it[tier] = "silver"
            }

            AuthUser(
                id = userId,
                firstName = payload.firstName.trim().ifBlank { null },
                lastName = payload.lastName.trim().ifBlank { null },
                email = email,
                phone = payload.phone?.trim()?.ifBlank { null },
                role = "customer"
            )
        } ?: return null

        return AuthResponse(issueToken(user.id), user)
    }

    fun login(payload: LoginRequest): AuthResponse? {
        val email = payload.email.trim().lowercase()
        val user = transaction {
            UsersTable
                .selectAll()
                .where { (UsersTable.email eq email) and (UsersTable.passwordHash eq sha256(payload.password)) }
                .firstOrNull()
                ?.let { row ->
                    AuthUser(
                        id = row[UsersTable.id],
                        firstName = row[UsersTable.firstName],
                        lastName = row[UsersTable.lastName],
                        email = row[UsersTable.email],
                        phone = null,
                        role = row[UsersTable.role]
                    )
                }
        } ?: return null

        return AuthResponse(issueToken(user.id), user)
    }

    fun getProfileByToken(token: String): AuthUser? {
        val userId = tokenToUserId[token] ?: return null
        return transaction {
            UsersTable
                .selectAll()
                .where { UsersTable.id eq userId }
                .firstOrNull()
                ?.let { row ->
                    AuthUser(
                        id = row[UsersTable.id],
                        firstName = row[UsersTable.firstName],
                        lastName = row[UsersTable.lastName],
                        email = row[UsersTable.email],
                        phone = null,
                        role = row[UsersTable.role]
                    )
                }
        }
    }

    private fun issueToken(userId: Int): String {
        val token = UUID.randomUUID().toString()
        tokenToUserId[token] = userId
        return token
    }

    private fun sha256(value: String): String {
        val bytes = MessageDigest.getInstance("SHA-256").digest(value.toByteArray())
        return bytes.joinToString("") { "%02x".format(it) }
    }
}
