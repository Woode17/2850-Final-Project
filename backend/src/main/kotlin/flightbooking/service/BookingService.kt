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

    @Serializable
    data class BoardingPass(
        val bookingId: Int,
        val bookingReference: String,
        val seat: String,
        val gate: String,
        val boardingTime: String,
        val status: String,
    )

    fun getAllBookings(userId: Int): List<Booking> = transaction {
        val bookingRows = BookingsTable.selectAll()
            .filter { it[BookingsTable.userId] == userId }
            .sortedByDescending { it[BookingsTable.createdAt] }

        bookingRows.mapNotNull { row -> hydrateBooking(row) }
    }

    fun getAllBookingsForAdmin(): List<Booking> = transaction {
        BookingsTable.selectAll()
            .sortedByDescending { it[BookingsTable.createdAt] }
            .mapNotNull { row -> hydrateBooking(row) }
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

    fun cancelBooking(bookingId: Int): Booking = transaction {
        val bookingRow = loadBookingRowOrThrow(bookingId)
        val currentStatus = bookingRow[BookingsTable.status]

        if (currentStatus == cancelledBookingStatus) {
            return@transaction hydrateBooking(bookingRow)
                ?: throw IllegalStateException("Cancelled booking could not be loaded")
        }

        if (currentStatus == checkedInBookingStatus) {
            throw IllegalArgumentException("Checked-in bookings cannot be cancelled")
        }

        restoreSeatsForBooking(bookingId)
        updateBookingStatus(bookingId, cancelledBookingStatus)

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

        ModificationRequestsTable.insert { row ->
            row[ModificationRequestsTable.bookingId] = bookingId
            row[requestType] = request.requestType?.trim().takeUnless { it.isNullOrBlank() } ?: "general"
            row[description] = request.description?.trim().takeUnless { it.isNullOrBlank() }
            row[status] = "processed"
            row[createdAt] = LocalDateTime.now()
            row[processedBy] = null
        }

        hydrateBookingById(bookingId) ?: throw IllegalStateException("Modified booking could not be loaded")
    }

    private fun loadBookingRowOrThrow(bookingId: Int): ResultRow {
        return BookingsTable.selectAll().firstOrNull { it[BookingsTable.id] == bookingId }
            ?: throw IllegalArgumentException("Booking not found")
    }

    private fun updateBookingStatus(bookingId: Int, status: String) {
        BookingsTable.update({ BookingsTable.id eq bookingId }) { row ->
            row[BookingsTable.status] = status
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

    private fun detectCardBrand(cardNumber: String): String = when {
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

    private fun hydrateBooking(bookingRow: ResultRow): Booking? {
        val bookingId = bookingRow[BookingsTable.id]
        val bookingReference = bookingRow[BookingsTable.bookingReference]

        val passenger = PassengersTable.selectAll()
            .firstOrNull { it[PassengersTable.bookingId] == bookingId }
            ?.toPassenger()
            ?: Passenger()

        val flightId = BookingFlightsTable.selectAll()
            .firstOrNull { it[BookingFlightsTable.bookingId] == bookingId }
            ?.get(BookingFlightsTable.flightId)

        val flight = flightId?.let { loadFlightSummary(it) }
        val latestModification = ModificationRequestsTable.selectAll()
            .filter { it[ModificationRequestsTable.bookingId] == bookingId }
            .maxByOrNull { it[ModificationRequestsTable.createdAt] }

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
        )
    }

    private fun displayStatus(status: String): String = when (status.lowercase()) {
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
        val departureAirportId = scheduleRow[FlightSchedulesTable.departureAirportId]
        val arrivalAirportId = scheduleRow[FlightSchedulesTable.arrivalAirportId]
        val airportsById = AirportsTable.selectAll().associateBy { it[AirportsTable.id] }

        val departureAirport = airportsById[departureAirportId]
        val arrivalAirport = airportsById[arrivalAirportId]
        val departureDateTime = scheduledFlightRow[ScheduledFlightsTable.departureTime]
        val arrivalDateTime = scheduledFlightRow[ScheduledFlightsTable.arrivalTime]

        return BookingFlightSummary(
            id = flightId,
            flightNumber = scheduleRow[FlightSchedulesTable.flightNumber],
            from = departureAirport?.get(AirportsTable.code),
            to = arrivalAirport?.get(AirportsTable.code),
            departureTime = departureDateTime.toLocalTime().toString(),
            arrivalTime = arrivalDateTime.toLocalTime().toString(),
            departureDate = departureDateTime.toLocalDate().toString(),
        )
    }

    private fun ResultRow.toPassenger(): Passenger = Passenger(
        firstName = this[PassengersTable.firstName].orEmpty(),
        lastName = this[PassengersTable.lastName].orEmpty(),
        email = this[PassengersTable.email].orEmpty(),
    )
}
