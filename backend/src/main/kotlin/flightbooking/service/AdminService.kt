package flightbooking.service

import flightbooking.db.table.LoyaltyAccountsTable
import flightbooking.db.table.ModificationRequestsTable
import flightbooking.db.table.ComplaintsTable
import flightbooking.db.table.BookingsTable
import flightbooking.db.table.UsersTable
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonIgnoreUnknownKeys
import org.jetbrains.exposed.sql.selectAll
import org.jetbrains.exposed.sql.transactions.transaction
import org.jetbrains.exposed.sql.update
import java.nio.charset.StandardCharsets
import java.time.LocalDateTime
import java.time.format.DateTimeFormatter
import java.util.Base64

object AdminService {
    private val json = Json {
        ignoreUnknownKeys = true
    }

    private const val adminTokenPrefix = "leedsair-admin"

    @OptIn(ExperimentalSerializationApi::class)
    @Serializable
    @JsonIgnoreUnknownKeys
    data class AdminLoginRequest(
        val username: String = "",
        val password: String = "",
    )

    @Serializable
    data class AdminLoginResponse(
        val token: String,
    )

    @Serializable
    data class AdminMetrics(
        val totalBookings: Int,
        val cancellations: Int,
        val totalRevenue: Double,
        val popularRoute: String,
        val activeUsers: Int,
        val cancellationRate: Double,
    )

    @Serializable
    data class ReportCount(
        val route: String,
        val count: Int,
    )

    @Serializable
    data class ReportBreakdown(
        val label: String,
        val count: Int,
    )

    @Serializable
    data class ReportRevenue(
        val route: String,
        val revenue: Double,
    )

    @Serializable
    data class MonthlyRevenue(
        val month: String,
        val revenue: Double,
    )

    @Serializable
    data class BookingFlightCount(
        val flightNumber: String,
        val count: Int,
    )

    @Serializable
    data class AdminReports(
        val cancellationRate: Double,
        val peakBookingHour: String,
        val bookingsPerFlight: List<BookingFlightCount>,
        val popularRoutes: List<ReportCount>,
        val revenuePerRoute: List<ReportRevenue>,
        val bookingsByStatus: List<ReportBreakdown>,
        val cancellationReasons: List<ReportBreakdown>,
        val loyaltyMix: List<ReportBreakdown>,
        val monthlyRevenue: List<MonthlyRevenue>,
    )

    @OptIn(ExperimentalSerializationApi::class)
    @Serializable
    @JsonIgnoreUnknownKeys
    data class ModificationDecisionRequest(
        val decision: String = "",
        val note: String = "",
    )

    @Serializable
    data class AdminComplaint(
        val id: Int,
        val bookingReference: String? = null,
        val customerName: String,
        val customerEmail: String? = null,
        val subject: String? = null,
        val message: String? = null,
        val status: String,
        val createdAt: String,
    )

    fun login(requestBody: String): AdminLoginResponse {
        val request = json.decodeFromString<AdminLoginRequest>(requestBody)
        val expectedUsername = System.getenv("ADMIN_USERNAME") ?: "admin"
        val expectedPassword = System.getenv("ADMIN_PASSWORD") ?: "admin12345"

        if (request.username.trim() != expectedUsername || request.password != expectedPassword) {
            throw IllegalArgumentException("Invalid admin credentials")
        }

        return AdminLoginResponse(token = createAdminToken(request.username.trim()))
    }

    fun requireAdmin(authorizationHeader: String?) {
        val token = extractBearerToken(authorizationHeader)
            ?: throw IllegalArgumentException("Missing or invalid Authorization header")
        if (!isValidAdminToken(token)) {
            throw IllegalArgumentException("Invalid admin token")
        }
    }

    fun getBookings(authorizationHeader: String?): List<BookingService.Booking> {
        requireAdmin(authorizationHeader)
        return BookingService.getAllBookingsForAdmin()
    }

    fun getMetrics(authorizationHeader: String?): AdminMetrics {
        requireAdmin(authorizationHeader)
        val bookings = BookingService.getAllBookingsForAdmin()

        val cancellations = bookings.count { it.status == "Cancelled" }
        val totalRevenue = bookings.filterNot { it.status == "Cancelled" }.sumOf { it.totalPrice }
        val routeCounts = bookings.groupingBy { "${it.flight?.from ?: it.from} -> ${it.flight?.to ?: it.to}" }.eachCount()
        val popularRoute = routeCounts.maxByOrNull { it.value }?.key ?: "-"
        val activeUsers = bookings.map { it.userId }.distinct().size
        val cancellationRate = if (bookings.isEmpty()) 0.0 else (cancellations.toDouble() / bookings.size.toDouble()) * 100.0

        return AdminMetrics(
            totalBookings = bookings.size,
            cancellations = cancellations,
            totalRevenue = round2(totalRevenue),
            popularRoute = popularRoute,
            activeUsers = activeUsers,
            cancellationRate = round2(cancellationRate),
        )
    }

    fun getReports(authorizationHeader: String?): AdminReports {
        requireAdmin(authorizationHeader)
        val bookings = BookingService.getAllBookingsForAdmin()
        val loyaltyUserIds = transaction {
            LoyaltyAccountsTable.selectAll().map { it[LoyaltyAccountsTable.userId] }.toSet()
        }

        val cancellationRate = if (bookings.isEmpty()) 0.0 else {
            bookings.count { it.status == "Cancelled" }.toDouble() / bookings.size.toDouble() * 100.0
        }

        val bookingsPerFlight = bookings.groupingBy { it.flight?.flightNumber ?: "-" }
            .eachCount()
            .entries
            .sortedByDescending { it.value }
            .take(10)
            .map { BookingFlightCount(flightNumber = it.key, count = it.value) }

        val popularRoutes = bookings.groupingBy { "${it.flight?.from ?: it.from} -> ${it.flight?.to ?: it.to}" }
            .eachCount()
            .entries
            .sortedByDescending { it.value }
            .take(10)
            .map { ReportCount(route = it.key, count = it.value) }

        val revenuePerRoute = bookings
            .filterNot { it.status == "Cancelled" }
            .groupBy { "${it.flight?.from ?: it.from} -> ${it.flight?.to ?: it.to}" }
            .map { (route, rows) -> ReportRevenue(route = route, revenue = round2(rows.sumOf { it.totalPrice })) }
            .sortedByDescending { it.revenue }
            .take(10)

        val bookingsByStatus = bookings
            .groupingBy { it.status.ifBlank { "Unknown" } }
            .eachCount()
            .entries
            .sortedByDescending { it.value }
            .map { ReportBreakdown(label = it.key, count = it.value) }

        val cancellationReasons = bookings
            .filter { it.status == "Cancelled" }
            .groupingBy { it.cancellationReason?.takeIf(String::isNotBlank) ?: "No reason recorded" }
            .eachCount()
            .entries
            .sortedByDescending { it.value }
            .take(8)
            .map { ReportBreakdown(label = it.key, count = it.value) }

        val loyaltyMix = listOf(
            ReportBreakdown(
                label = "Loyalty Members",
                count = bookings.count { it.userId in loyaltyUserIds }
            ),
            ReportBreakdown(
                label = "Non-members",
                count = bookings.count { it.userId !in loyaltyUserIds }
            ),
        )

        val monthlyRevenue = bookings
            .filterNot { it.status == "Cancelled" }
            .groupBy { booking ->
                runCatching {
                    LocalDateTime.parse(booking.createdAt).format(DateTimeFormatter.ofPattern("MMM yyyy"))
                }.getOrDefault(booking.createdAt.take(7))
            }
            .map { (month, rows) -> MonthlyRevenue(month = month, revenue = round2(rows.sumOf { it.totalPrice })) }
            .sortedBy { it.month.takeLast(4) + it.month.take(3) }
            .takeLast(6)

        val peakBookingHour = bookings
            .groupingBy {
                it.createdAt.substringAfter("T", "00:00").substring(0, 2) + ":00"
            }
            .eachCount()
            .maxByOrNull { it.value }
            ?.key
            ?: "-"

        return AdminReports(
            cancellationRate = round2(cancellationRate),
            peakBookingHour = peakBookingHour,
            bookingsPerFlight = bookingsPerFlight,
            popularRoutes = popularRoutes,
            revenuePerRoute = revenuePerRoute,
            bookingsByStatus = bookingsByStatus,
            cancellationReasons = cancellationReasons,
            loyaltyMix = loyaltyMix,
            monthlyRevenue = monthlyRevenue,
        )
    }

    fun getComplaints(authorizationHeader: String?): List<AdminComplaint> {
        requireAdmin(authorizationHeader)
        return transaction {
            val usersById = UsersTable.selectAll().associateBy { it[UsersTable.id] }
            val bookingsById = BookingsTable.selectAll().associateBy { it[BookingsTable.id] }

            ComplaintsTable.selectAll()
                .sortedByDescending { it[ComplaintsTable.createdAt] }
                .map { row ->
                    val user = usersById[row[ComplaintsTable.userId]]
                    val bookingReference = row[ComplaintsTable.bookingId]?.let { bookingId ->
                        bookingsById[bookingId]?.get(BookingsTable.bookingReference)
                    }
                    val customerName = listOfNotNull(
                        user?.get(UsersTable.firstName)?.takeIf { it.isNotBlank() },
                        user?.get(UsersTable.lastName)?.takeIf { it.isNotBlank() },
                    ).joinToString(" ").ifBlank { "Guest customer" }

                    AdminComplaint(
                        id = row[ComplaintsTable.id],
                        bookingReference = bookingReference,
                        customerName = customerName,
                        customerEmail = user?.get(UsersTable.email),
                        subject = row[ComplaintsTable.subject],
                        message = row[ComplaintsTable.message],
                        status = row[ComplaintsTable.status].replaceFirstChar { it.uppercase() },
                        createdAt = row[ComplaintsTable.createdAt].toString(),
                    )
                }
        }
    }

    fun resolveModificationRequest(authorizationHeader: String?, requestId: Int, requestBody: String): BookingService.Booking {
        requireAdmin(authorizationHeader)
        val request = json.decodeFromString<ModificationDecisionRequest>(requestBody)
        val decision = request.decision.trim().lowercase()
        if (decision != "approved" && decision != "rejected") {
            throw IllegalArgumentException("Decision must be either approved or rejected")
        }

        val resolved = transaction {
            val requestRow = ModificationRequestsTable.selectAll()
                .firstOrNull { it[ModificationRequestsTable.id] == requestId }
                ?: throw IllegalArgumentException("Modification request not found")

            val currentStatus = requestRow[ModificationRequestsTable.status].lowercase()
            if (currentStatus != "pending") {
                throw IllegalArgumentException("Only pending requests can be updated")
            }

            val existingDescription = requestRow[ModificationRequestsTable.description].orEmpty().trim()
            val adminNote = request.note.trim()
            val resolvedDescription = buildString {
                if (existingDescription.isNotBlank()) {
                    append(existingDescription)
                }
                if (adminNote.isNotBlank()) {
                    if (isNotEmpty()) append("\n\n")
                    append("Admin note: ")
                    append(adminNote)
                }
            }.ifBlank { null }

            ModificationRequestsTable.update({ ModificationRequestsTable.id eq requestId }) { row ->
                row[status] = decision
                row[description] = resolvedDescription
            }

            Triple(
                requestRow[ModificationRequestsTable.bookingId],
                requestRow[ModificationRequestsTable.requestType],
                resolvedDescription,
            )
        }
        val bookingId = resolved.first
        val requestType = resolved.second
        val description = resolved.third

        if (decision == "approved") {
            BookingService.applyApprovedRequest(
                bookingId = bookingId,
                requestType = requestType,
                description = description,
            )
        }

        return BookingService.getAllBookingsForAdmin()
            .firstOrNull { it.id == bookingId }
            ?: throw IllegalStateException("Updated booking could not be loaded")
    }

    private fun createAdminToken(username: String): String {
        val payload = "$adminTokenPrefix:$username"
        return Base64.getUrlEncoder().withoutPadding()
            .encodeToString(payload.toByteArray(StandardCharsets.UTF_8))
    }

    private fun isValidAdminToken(token: String): Boolean {
        val decoded = runCatching {
            String(Base64.getUrlDecoder().decode(token), StandardCharsets.UTF_8)
        }.getOrNull() ?: return false

        return decoded.startsWith("$adminTokenPrefix:")
    }

    private fun extractBearerToken(authorizationHeader: String?): String? {
        if (authorizationHeader.isNullOrBlank()) return null
        val prefix = "Bearer "
        if (!authorizationHeader.startsWith(prefix, ignoreCase = true)) return null
        return authorizationHeader.substring(prefix.length).trim().takeIf { it.isNotBlank() }
    }

    private fun round2(value: Double): Double = kotlin.math.round(value * 100.0) / 100.0
}
