package flightbooking.service

import flightbooking.db.table.AirportsTable
import flightbooking.db.table.BookingFlightsTable
import flightbooking.db.table.BookingsTable
import flightbooking.db.table.FlightSchedulesTable
import flightbooking.db.table.ModificationRequestsTable
import flightbooking.db.table.PassengersTable
import flightbooking.db.table.PaymentsTable
import flightbooking.db.table.ScheduledFlightsTable
import flightbooking.db.table.UsersTable
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonIgnoreUnknownKeys
import org.jetbrains.exposed.sql.ResultRow
import org.jetbrains.exposed.sql.SqlExpressionBuilder.inList
import org.jetbrains.exposed.sql.andWhere
import org.jetbrains.exposed.sql.insert
import org.jetbrains.exposed.sql.selectAll
import org.jetbrains.exposed.sql.update
import org.jetbrains.exposed.sql.transactions.transaction
import java.math.BigDecimal
import java.time.LocalDateTime
import java.time.format.DateTimeFormatter
import java.util.UUID

object BookingService {
    private val json = Json {
        ignoreUnknownKeys = true
    }

    private const val defaultUserId = 1
    private const val defaultBookingStatus = "confirmed"
    private const val cancelledBookingStatus = "cancelled"
    private const val checkedInBookingStatus = "checked_in"
    private const val defaultTravelClass = "Economy"
    private const val defaultSeatLabel = "Auto-assigned"

    @OptIn(ExperimentalSerializationApi::class)
    @Serializable
    @JsonIgnoreUnknownKeys
    data class Passenger(
        val firstName: String = "",
        val lastName: String = "",
        val dateOfBirth: String = "",
        val passportNumber: String = "",
        val email: String = "",
        val phone: String = ""
    )

    @Serializable
    data class BookingFlightSummary(
        val id: Int,
        val flightNumber: String? = null,
        val from: String? = null,
        val to: String? = null,
        val departureTime: String? = null,
        val arrivalTime: String? = null,
        val departureDate: String? = null,
        val stops: Int = 0,
    )

    @Serializable
    data class Booking(
        val id: Int,
        val ref: String,
        val bookingReference: String,
        val userId: Int,
        val flightId: String = "",
        val travelClass: String = "",
        val seat: String = "",
        val extras: List<String> = emptyList(),
        val totalPrice: Double,
        val status: String,
        val checkedIn: Boolean = false,
        val createdAt: String,
        val passenger: Passenger,
        val flight: BookingFlightSummary? = null,
        val from: String? = flight?.from,
        val to: String? = flight?.to,
        val departureDate: String? = flight?.departureDate,
        val modificationRequested: String? = null,
        val modificationRequestedAt: String? = null,
        val cancellationReason: String? = null,
        val cancelledAt: String? = null,
        val requestHistory: List<BookingRequestHistoryItem> = emptyList(),
    )

    @Serializable
    data class BookingRequestHistoryItem(
        val id: Int,
        val requestType: String,
        val status: String,
        val description: String? = null,
        val createdAt: String,
    )

    @OptIn(ExperimentalSerializationApi::class)
    @Serializable
    @JsonIgnoreUnknownKeys
    data class BookingCreateRequest(
        val userId: Int? = null,
        val flightId: String = "",
        val travelClass: String = "",
        val seat: String = "",
        val extras: List<String> = emptyList(),
        val totalPrice: Double = 0.0,
        val passenger: Passenger? = null,
        val passengers: List<Passenger> = emptyList(),
        val payment: PaymentDetails? = null,
    )

    @OptIn(ExperimentalSerializationApi::class)
    @Serializable
    @JsonIgnoreUnknownKeys
    data class PaymentDetails(
        val cardholderName: String = "",
        val cardNumber: String = "",
        val expiryMonth: Int? = null,
        val expiryYear: Int? = null,
        val cvv: String = "",
        val billingPostalCode: String = "",
    )

    @OptIn(ExperimentalSerializationApi::class)
    @Serializable
    @JsonIgnoreUnknownKeys
    data class BookingModifyRequest(
        val totalPrice: Double? = null,
        val status: String? = null,
        val description: String? = null,
        val requestType: String? = null,
    )

    @OptIn(ExperimentalSerializationApi::class)
    @Serializable
    @JsonIgnoreUnknownKeys
    data class BookingCancelRequest(
        val reason: String = "",
    )

    @Serializable
    data class BoardingPass(
        val bookingId: Int,
        val bookingReference: String,
        val seat: String,
        val gate: String,
        val boardingTime: String,
        val status: String,
    )

    private data class BookingHydrationContext(
        val passengersByBookingId: Map<Int, ResultRow>,
        val flightIdByBookingId: Map<Int, Int>,
        val flightsById: Map<Int, BookingFlightSummary>,
        val modificationsByBookingId: Map<Int, List<ResultRow>>,
    )

    fun getAllBookings(userId: Int): List<Booking> = transaction {
        val bookingRows = BookingsTable.selectAll()
            .filter { it[BookingsTable.userId] == userId }
            .sortedByDescending { it[BookingsTable.createdAt] }

        hydrateBookings(bookingRows)
    }

    fun getAllBookingsForAdmin(): List<Booking> = transaction {
        val bookingRows = BookingsTable.selectAll()
            .sortedByDescending { it[BookingsTable.createdAt] }

        hydrateBookings(bookingRows)
    }

    fun getBooking(lastName: String, ref: String): Booking? = transaction {
        val normalizedRef = ref.trim()
        val normalizedLastName = lastName.trim().lowercase()

        val bookingRow = BookingsTable.selectAll()
            .firstOrNull { it[BookingsTable.bookingReference].equals(normalizedRef, ignoreCase = true) }
            ?: return@transaction null

        val booking = hydrateBooking(bookingRow)
            ?: return@transaction null

        val matchesLastName = booking.passenger.lastName.trim().lowercase() == normalizedLastName
        if (!matchesLastName) null else booking
    }

    fun newBooking(str: String): Booking = transaction {
        val request = json.decodeFromString<BookingCreateRequest>(str)
        val flightId = request.flightId.trim().toIntOrNull()
            ?: throw IllegalArgumentException("flightId must be a numeric flight id")

        val passengers = request.passengers.ifEmpty {
            listOfNotNull(request.passenger)
        }.filter { passenger ->
            passenger.firstName.isNotBlank() || passenger.lastName.isNotBlank() || passenger.email.isNotBlank()
        }

        if (passengers.isEmpty()) {
            throw IllegalArgumentException("At least one passenger is required")
        }

        reserveSeats(flightId = flightId, seatsRequested = passengers.size)

        val resolvedUserId = ensureUserExists(request.userId ?: defaultUserId)
        val bookingReference = generateBookingReference()
        val now = LocalDateTime.now()

        val bookingId = BookingsTable.insert { row ->
            row[userId] = resolvedUserId
            row[BookingsTable.bookingReference] = bookingReference
            row[totalPrice] = BigDecimal.valueOf(request.totalPrice).setScale(2)
            row[status] = defaultBookingStatus
            row[createdAt] = now
        }[BookingsTable.id]

        passengers.forEach { passenger ->
            PassengersTable.insert { row ->
                row[PassengersTable.bookingId] = bookingId
                row[firstName] = passenger.firstName.ifBlank { null }
                row[lastName] = passenger.lastName.ifBlank { null }
                row[email] = passenger.email.ifBlank { null }
            }
        }

        BookingFlightsTable.insert { row ->
            row[BookingFlightsTable.bookingId] = bookingId
            row[BookingFlightsTable.flightId] = flightId
        }

        saveDummyPayment(
            bookingId = bookingId,
            amount = BigDecimal.valueOf(request.totalPrice).setScale(2),
            payment = request.payment
        )

        val requestedUserId = request.userId?.takeIf { it > 0 }
        if (requestedUserId != null) {
            LoyaltyService.awardPointsForBooking(
                userId = requestedUserId,
                bookingId = bookingId,
                totalPrice = request.totalPrice,
                travelClass = request.travelClass,
            )
        }

        hydrateBookingById(bookingId) ?: throw IllegalStateException("Booking was created but could not be loaded")
    }

    fun cancelBooking(bookingId: Int, requestBody: String? = null): Booking = transaction {
        val bookingRow = loadBookingRowOrThrow(bookingId)
        val currentStatus = bookingRow[BookingsTable.status]
        val cancelRequest = requestBody
            ?.takeIf { it.isNotBlank() }
            ?.let { json.decodeFromString<BookingCancelRequest>(it) }
        val cancellationReason = cancelRequest?.reason?.trim().takeUnless { it.isNullOrBlank() }

        if (currentStatus == cancelledBookingStatus) {
            return@transaction hydrateBooking(bookingRow)
                ?: throw IllegalStateException("Cancelled booking could not be loaded")
        }

        if (currentStatus == checkedInBookingStatus) {
            throw IllegalArgumentException("Checked-in bookings cannot be cancelled")
        }

        restoreSeatsForBooking(bookingId)
        updateBookingStatus(bookingId, cancelledBookingStatus)
        recordModificationRequest(
            bookingId = bookingId,
            requestType = "cancellation",
            description = cancellationReason ?: "Cancelled by customer from manage booking.",
            status = "completed",
        )

        hydrateBookingById(bookingId) ?: throw IllegalStateException("Cancelled booking could not be loaded")
    }

    fun checkInBooking(bookingId: Int): BoardingPass = transaction {
        val bookingRow = loadBookingRowOrThrow(bookingId)
        val currentStatus = bookingRow[BookingsTable.status]

        if (currentStatus == cancelledBookingStatus) {
            throw IllegalArgumentException("Cancelled bookings cannot be checked in")
        }

        if (currentStatus != checkedInBookingStatus) {
            updateBookingStatus(bookingId, checkedInBookingStatus)
        }

        val hydrated = hydrateBookingById(bookingId)
            ?: throw IllegalStateException("Checked-in booking could not be loaded")

        val departureTime = hydrated.flight?.departureTime ?: "00:00"
        val boardingTime = runCatching {
            java.time.LocalTime.parse(departureTime).minusMinutes(45).toString()
        }.getOrElse { "00:00" }

        BoardingPass(
            bookingId = hydrated.id,
            bookingReference = hydrated.bookingReference,
            seat = defaultSeatLabel,
            gate = generateGate(hydrated.id),
            boardingTime = boardingTime,
            status = "Checked In",
        )
    }

    fun modifyBooking(bookingId: Int, requestBody: String): Booking = transaction {
        val bookingRow = loadBookingRowOrThrow(bookingId)
        val currentStatus = bookingRow[BookingsTable.status]
        if (currentStatus == cancelledBookingStatus) {
            throw IllegalArgumentException("Cancelled bookings cannot be modified")
        }

        val request = json.decodeFromString<BookingModifyRequest>(requestBody)

        if (request.totalPrice != null) {
            BookingsTable.update({ BookingsTable.id eq bookingId }) { row ->
                row[totalPrice] = BigDecimal.valueOf(request.totalPrice).setScale(2)
            }
        }

        val normalizedStatus = request.status?.trim()?.lowercase()
        if (!normalizedStatus.isNullOrBlank()) {
            updateBookingStatus(bookingId, normalizedStatus)
        }

        val requestType = request.requestType?.trim().takeUnless { it.isNullOrBlank() } ?: "general"
        val requestStatus = if (requestType.equals("extra_request", ignoreCase = true)) "completed" else "pending"

        recordModificationRequest(
            bookingId = bookingId,
            requestType = requestType,
            description = request.description?.trim().takeUnless { it.isNullOrBlank() },
            status = requestStatus,
        )

        hydrateBookingById(bookingId) ?: throw IllegalStateException("Modified booking could not be loaded")
    }

    fun applyApprovedRequest(bookingId: Int, requestType: String, description: String?) = transaction {
        val normalizedType = requestType.trim().lowercase()
        val normalizedDescription = description.orEmpty()
        when (normalizedType) {
            "name_change" -> applyApprovedNameChange(bookingId, normalizedDescription)
            "date_change" -> applyApprovedDateChange(bookingId, normalizedDescription)
        }
    }

    private fun loadBookingRowOrThrow(bookingId: Int): ResultRow {
        return BookingsTable.selectAll().firstOrNull { it[BookingsTable.id] == bookingId }
            ?: throw IllegalArgumentException("Booking not found")
    }

    private fun applyApprovedNameChange(bookingId: Int, description: String) {
        val newName = extractNameChangeValue(description) ?: return
        val parts = newName.split(Regex("\\s+")).filter { it.isNotBlank() }
        if (parts.isEmpty()) return

        val first = parts.first()
        val last = parts.drop(1).joinToString(" ").ifBlank { "Updated" }
        val passengerRow = PassengersTable.selectAll().firstOrNull { it[PassengersTable.bookingId] == bookingId } ?: return
        val passengerId = passengerRow[PassengersTable.id]

        PassengersTable.update({ PassengersTable.id eq passengerId }) { row ->
            row[firstName] = first
            row[lastName] = last
        }
    }

    private fun applyApprovedDateChange(bookingId: Int, description: String) {
        val newFlightId = extractRequestedFlightId(description) ?: return
        val existingLink = BookingFlightsTable.selectAll().firstOrNull { it[BookingFlightsTable.bookingId] == bookingId } ?: return
        val currentFlightId = existingLink[BookingFlightsTable.flightId]
        if (currentFlightId == newFlightId) return

        val passengerCount = PassengersTable.selectAll().count { it[PassengersTable.bookingId] == bookingId }
        if (passengerCount == 0) return

        restoreSeatsForBooking(bookingId)
        reserveSeats(newFlightId, passengerCount)
        BookingFlightsTable.update({ BookingFlightsTable.bookingId eq bookingId }) { row ->
            row[flightId] = newFlightId
        }
    }

    private fun extractNameChangeValue(description: String): String? {
        val match = Regex("""Requested passenger name change to:\s*(.+)""", RegexOption.IGNORE_CASE)
            .find(description)
            ?: return null
        return match.groupValues.getOrNull(1)?.trim()?.takeIf { it.isNotBlank() }
    }

    private fun extractRequestedFlightId(description: String): Int? {
        val match = Regex("""Requested flight id:\s*(\d+)""", RegexOption.IGNORE_CASE)
            .find(description)
            ?: return null
        return match.groupValues.getOrNull(1)?.toIntOrNull()
    }

    private fun updateBookingStatus(bookingId: Int, status: String) {
        BookingsTable.update({ BookingsTable.id eq bookingId }) { row ->
            row[BookingsTable.status] = status
        }
    }

    private fun recordModificationRequest(
        bookingId: Int,
        requestType: String,
        description: String?,
        status: String,
    ) {
        ModificationRequestsTable.insert { row ->
            row[ModificationRequestsTable.bookingId] = bookingId
            row[ModificationRequestsTable.requestType] = requestType
            row[ModificationRequestsTable.description] = description
            row[ModificationRequestsTable.status] = status
            row[createdAt] = LocalDateTime.now()
            row[processedBy] = null
        }
    }

    private fun restoreSeatsForBooking(bookingId: Int) {
        val flightId = BookingFlightsTable.selectAll()
            .firstOrNull { it[BookingFlightsTable.bookingId] == bookingId }
            ?.get(BookingFlightsTable.flightId)
            ?: return

        val passengerCount = PassengersTable.selectAll().count { it[PassengersTable.bookingId] == bookingId }
        val scheduledFlightRow = ScheduledFlightsTable.selectAll()
            .firstOrNull { it[ScheduledFlightsTable.id] == flightId }
            ?: return

        val currentAvailableSeats = scheduledFlightRow[ScheduledFlightsTable.availableSeats] ?: return
        ScheduledFlightsTable.update({ ScheduledFlightsTable.id eq flightId }) { row ->
            row[availableSeats] = currentAvailableSeats + passengerCount
        }
    }

    private fun generateGate(bookingId: Int): String {
        val gateLetter = ('A'.code + (bookingId % 6)).toChar()
        val gateNumber = 1 + (bookingId % 24)
        return "$gateLetter$gateNumber"
    }

    private fun reserveSeats(flightId: Int, seatsRequested: Int) {
        val scheduledFlightRow = ScheduledFlightsTable.selectAll()
            .firstOrNull { it[ScheduledFlightsTable.id] == flightId }
            ?: throw IllegalArgumentException("flightId does not exist in scheduled_flights")

        val currentAvailableSeats = scheduledFlightRow[ScheduledFlightsTable.availableSeats]
        if (currentAvailableSeats != null) {
            if (currentAvailableSeats < seatsRequested) {
                throw IllegalArgumentException(
                    "Not enough seats available. Requested $seatsRequested but only $currentAvailableSeats left"
                )
            }

            ScheduledFlightsTable.update({ ScheduledFlightsTable.id eq flightId }) { row ->
                row[availableSeats] = currentAvailableSeats - seatsRequested
            }
        }
    }

    private fun ensureUserExists(userId: Int): Int {
        val normalizedUserId = userId.takeIf { it > 0 } ?: defaultUserId
        val exists = UsersTable.selectAll().any { it[UsersTable.id] == normalizedUserId }
        if (exists) return normalizedUserId

        UsersTable.insert { row ->
            row[id] = normalizedUserId
            row[firstName] = "Guest"
            row[lastName] = "User"
            row[email] = "guest$normalizedUserId@leedsair.local"
            row[passwordHash] = null
            row[role] = "customer"
            row[createdAt] = LocalDateTime.now()
        }
        return normalizedUserId
    }

    private fun generateBookingReference(): String {
        val timestamp = DateTimeFormatter.ofPattern("yyMMddHHmmss").format(LocalDateTime.now())
        var suffix = 0

        while (true) {
            val candidate = if (suffix == 0) {
                "LEEDS$timestamp"
            } else {
                "LEEDS$timestamp$suffix"
            }

            val exists = BookingsTable.selectAll().any { it[BookingsTable.bookingReference] == candidate }
            if (!exists) return candidate
            suffix += 1
        }
    }

    private fun saveDummyPayment(bookingId: Int, amount: BigDecimal, payment: PaymentDetails?) {
        val normalizedCardNumber = payment?.cardNumber?.filter(Char::isDigit).orEmpty()
        val cardLast4 = normalizedCardNumber.takeLast(4).ifBlank { "4242" }
        val providerPaymentMethodId = "pm_dummy_${UUID.randomUUID().toString().replace("-", "").take(16)}"
        val transactionReference = "txn_dummy_${UUID.randomUUID().toString().replace("-", "").take(18)}"

        PaymentsTable.insert { row ->
            row[PaymentsTable.bookingId] = bookingId
            row[PaymentsTable.amount] = amount
            row[PaymentsTable.paymentMethod] = "dummy_card"
            row[PaymentsTable.paymentStatus] = "paid"
            row[PaymentsTable.provider] = "dummy_gateway"
            row[PaymentsTable.providerPaymentMethodId] = providerPaymentMethodId
            row[PaymentsTable.cardholderName] = payment?.cardholderName?.trim().takeUnless { it.isNullOrBlank() } ?: "Demo Customer"
            row[PaymentsTable.cardBrand] = detectCardBrand(normalizedCardNumber)
            row[PaymentsTable.cardLast4] = cardLast4
            row[PaymentsTable.expiryMonth] = payment?.expiryMonth
            row[PaymentsTable.expiryYear] = payment?.expiryYear
            row[PaymentsTable.billingPostalCode] = payment?.billingPostalCode?.trim().takeUnless { it.isNullOrBlank() }
            row[PaymentsTable.isDummy] = true
            row[PaymentsTable.transactionReference] = transactionReference
            row[PaymentsTable.paymentDate] = LocalDateTime.now()
        }
    }

    internal fun detectCardBrand(cardNumber: String): String = when {
        cardNumber.startsWith("4") -> "Visa"
        cardNumber.startsWith("5") -> "Mastercard"
        cardNumber.startsWith("34") || cardNumber.startsWith("37") -> "American Express"
        cardNumber.startsWith("6") -> "Discover"
        cardNumber.isBlank() -> "Dummy"
        else -> "Other"
    }

    private fun hydrateBookingById(bookingId: Int): Booking? {
        val row = BookingsTable.selectAll().firstOrNull { it[BookingsTable.id] == bookingId } ?: return null
        return hydrateBooking(row)
    }

    private fun hydrateBookings(bookingRows: List<ResultRow>): List<Booking> {
        if (bookingRows.isEmpty()) return emptyList()
        val context = buildHydrationContext(bookingRows)
        return bookingRows.mapNotNull { row -> hydrateBooking(row, context) }
    }

    private fun buildHydrationContext(bookingRows: List<ResultRow>): BookingHydrationContext {
        val bookingIds = bookingRows.map { it[BookingsTable.id] }

        val passengerRows = PassengersTable.selectAll()
            .andWhere { PassengersTable.bookingId inList bookingIds }
            .toList()
        val passengersByBookingId = passengerRows
            .sortedBy { it[PassengersTable.id] }
            .associateBy { it[PassengersTable.bookingId] }

        val bookingFlightRows = BookingFlightsTable.selectAll()
            .andWhere { BookingFlightsTable.bookingId inList bookingIds }
            .toList()
        val flightIdByBookingId = bookingFlightRows.associate { row ->
            row[BookingFlightsTable.bookingId] to row[BookingFlightsTable.flightId]
        }

        val modificationsByBookingId = ModificationRequestsTable.selectAll()
            .andWhere { ModificationRequestsTable.bookingId inList bookingIds }
            .toList()
            .groupBy { it[ModificationRequestsTable.bookingId] }
            .mapValues { (_, rows) ->
                rows.sortedByDescending { it[ModificationRequestsTable.createdAt] }
            }

        val flightIds = flightIdByBookingId.values.distinct()
        val flightsById = if (flightIds.isEmpty()) {
            emptyMap()
        } else {
            val scheduledFlightRows = ScheduledFlightsTable.selectAll()
                .andWhere { ScheduledFlightsTable.id inList flightIds }
                .toList()
            val scheduledFlightsById = scheduledFlightRows.associateBy { it[ScheduledFlightsTable.id] }

            val scheduleIds = scheduledFlightRows.map { it[ScheduledFlightsTable.scheduleId] }.distinct()
            val scheduleRows = if (scheduleIds.isEmpty()) {
                emptyList()
            } else {
                FlightSchedulesTable.selectAll()
                    .andWhere { FlightSchedulesTable.id inList scheduleIds }
                    .toList()
            }
            val schedulesById = scheduleRows.associateBy { it[FlightSchedulesTable.id] }

            val airportIds = scheduleRows
                .flatMap { listOf(it[FlightSchedulesTable.departureAirportId], it[FlightSchedulesTable.arrivalAirportId]) }
                .distinct()
            val airportRows = if (airportIds.isEmpty()) {
                emptyList()
            } else {
                AirportsTable.selectAll()
                    .andWhere { AirportsTable.id inList airportIds }
                    .toList()
            }
            val airportsById = airportRows.associateBy { it[AirportsTable.id] }

            scheduledFlightsById.mapValues { (_, scheduledFlightRow) ->
                val scheduleRow = schedulesById[scheduledFlightRow[ScheduledFlightsTable.scheduleId]]
                    ?: return@mapValues null
                loadFlightSummaryFromRows(scheduledFlightRow, scheduleRow, airportsById)
            }.mapNotNull { (flightId, summary) ->
                summary?.let { flightId to it }
            }.toMap()
        }

        return BookingHydrationContext(
            passengersByBookingId = passengersByBookingId,
            flightIdByBookingId = flightIdByBookingId,
            flightsById = flightsById,
            modificationsByBookingId = modificationsByBookingId,
        )
    }

    private fun hydrateBooking(bookingRow: ResultRow): Booking? {
        val context = buildHydrationContext(listOf(bookingRow))
        return hydrateBooking(bookingRow, context)
    }

    private fun hydrateBooking(bookingRow: ResultRow, context: BookingHydrationContext): Booking? {
        val bookingId = bookingRow[BookingsTable.id]
        val bookingReference = bookingRow[BookingsTable.bookingReference]

        val passenger = context.passengersByBookingId[bookingId]
            ?.toPassenger()
            ?: Passenger()

        val flightId = context.flightIdByBookingId[bookingId]

        val flight = flightId?.let { context.flightsById[it] ?: loadFlightSummary(it) }
        val modificationHistory = context.modificationsByBookingId[bookingId].orEmpty()
        val latestModification = modificationHistory.firstOrNull()
        val cancellationModification = modificationHistory.firstOrNull {
            it[ModificationRequestsTable.requestType].equals("cancellation", ignoreCase = true)
        }

        return Booking(
            id = bookingId,
            ref = bookingReference,
            bookingReference = bookingReference,
            userId = bookingRow[BookingsTable.userId],
            flightId = flightId?.toString().orEmpty(),
            travelClass = defaultTravelClass,
            seat = defaultSeatLabel,
            extras = emptyList(),
            totalPrice = bookingRow[BookingsTable.totalPrice].toDouble(),
            status = displayStatus(bookingRow[BookingsTable.status]),
            checkedIn = bookingRow[BookingsTable.status] == checkedInBookingStatus,
            createdAt = bookingRow[BookingsTable.createdAt].toString(),
            passenger = passenger,
            flight = flight,
            modificationRequested = latestModification?.get(ModificationRequestsTable.requestType)?.replaceFirstChar { it.uppercase() },
            modificationRequestedAt = latestModification?.get(ModificationRequestsTable.createdAt)?.toString(),
            cancellationReason = cancellationModification?.get(ModificationRequestsTable.description),
            cancelledAt = cancellationModification?.get(ModificationRequestsTable.createdAt)?.toString(),
            requestHistory = modificationHistory.map { row ->
                BookingRequestHistoryItem(
                    id = row[ModificationRequestsTable.id],
                    requestType = row[ModificationRequestsTable.requestType],
                    status = row[ModificationRequestsTable.status],
                    description = row[ModificationRequestsTable.description],
                    createdAt = row[ModificationRequestsTable.createdAt].toString(),
                )
            },
        )
    }

    internal fun displayStatus(status: String): String = when (status.lowercase()) {
        checkedInBookingStatus -> "CheckedIn"
        cancelledBookingStatus -> "Cancelled"
        defaultBookingStatus -> "Confirmed"
        else -> status.replaceFirstChar { it.uppercase() }
    }

    private fun loadFlightSummary(flightId: Int): BookingFlightSummary? {
        val scheduledFlightRow = ScheduledFlightsTable.selectAll()
            .firstOrNull { it[ScheduledFlightsTable.id] == flightId }
            ?: return null
        val scheduleRow = FlightSchedulesTable.selectAll()
            .firstOrNull { it[FlightSchedulesTable.id] == scheduledFlightRow[ScheduledFlightsTable.scheduleId] }
            ?: return null
        val airportsById = AirportsTable.selectAll().associateBy { it[AirportsTable.id] }

        return loadFlightSummaryFromRows(scheduledFlightRow, scheduleRow, airportsById)
    }

    private fun loadFlightSummaryFromRows(
        scheduledFlightRow: ResultRow,
        scheduleRow: ResultRow,
        airportsById: Map<Int, ResultRow>,
    ): BookingFlightSummary {
        val departureAirport = airportsById[scheduleRow[FlightSchedulesTable.departureAirportId]]
        val arrivalAirport = airportsById[scheduleRow[FlightSchedulesTable.arrivalAirportId]]
        val departureDateTime = scheduledFlightRow[ScheduledFlightsTable.departureTime]
        val arrivalDateTime = scheduledFlightRow[ScheduledFlightsTable.arrivalTime]

        return BookingFlightSummary(
            id = scheduledFlightRow[ScheduledFlightsTable.id],
            flightNumber = scheduleRow[FlightSchedulesTable.flightNumber],
            from = departureAirport?.get(AirportsTable.code),
            to = arrivalAirport?.get(AirportsTable.code),
            departureTime = departureDateTime.toLocalTime().toString(),
            arrivalTime = arrivalDateTime.toLocalTime().toString(),
            departureDate = departureDateTime.toLocalDate().toString(),
            stops = scheduleRow[FlightSchedulesTable.stops],
        )
    }

    private fun ResultRow.toPassenger(): Passenger = Passenger(
        firstName = this[PassengersTable.firstName].orEmpty(),
        lastName = this[PassengersTable.lastName].orEmpty(),
        email = this[PassengersTable.email].orEmpty(),
    )
}
