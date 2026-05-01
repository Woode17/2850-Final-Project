package flightbooking.db.table

import org.jetbrains.exposed.sql.ReferenceOption
import org.jetbrains.exposed.sql.Table
import org.jetbrains.exposed.sql.javatime.datetime
import org.jetbrains.exposed.sql.javatime.time

object UsersTable : Table("users") {
    val id = integer("id").autoIncrement()
    val firstName = varchar("first_name", 255).nullable()
    val lastName = varchar("last_name", 255).nullable()
    val email = varchar("email", 255).uniqueIndex()
    val passwordHash = varchar("password_hash", 255).nullable()
    val role = varchar("role", 32)
    val createdAt = datetime("created_at")
    override val primaryKey = PrimaryKey(id)
}

object AirportsTable : Table("airports") {
    val id = integer("id").autoIncrement()
    val code = varchar("code", 8).uniqueIndex()
    val name = varchar("name", 255).nullable()
    val city = varchar("city", 255).nullable()
    val country = varchar("country", 255).nullable()
    override val primaryKey = PrimaryKey(id)
}

object AircraftTable : Table("aircraft") {
    val id = integer("id").autoIncrement()
    val model = varchar("model", 255).nullable()
    val totalSeats = integer("total_seats")
    override val primaryKey = PrimaryKey(id)
}

object FlightsTable : Table("flights") {
    val id = integer("id").autoIncrement()
    val flightNumber = varchar("flight_number", 32)
    val departureAirportId = reference("departure_airport_id", AirportsTable.id, onDelete = ReferenceOption.RESTRICT)
    val arrivalAirportId = reference("arrival_airport_id", AirportsTable.id, onDelete = ReferenceOption.RESTRICT)
    val departureTime = datetime("departure_time")
    val arrivalTime = datetime("arrival_time")
    val aircraftId = reference("aircraft_id", AircraftTable.id, onDelete = ReferenceOption.RESTRICT)
    val basePrice = decimal("base_price", 12, 2)
    val status = varchar("status", 32)
    override val primaryKey = PrimaryKey(id)
}

object FlightSchedulesTable : Table("flight_schedules") {
    val id = integer("id").autoIncrement()
    val flightNumber = varchar("flight_number", 32)
    val airline = varchar("airline", 255)
    val departureAirportId = reference("departure_airport_id", AirportsTable.id, onDelete = ReferenceOption.RESTRICT)
    val arrivalAirportId = reference("arrival_airport_id", AirportsTable.id, onDelete = ReferenceOption.RESTRICT)
    val departureTime = time("departure_time")
    val arrivalTime = time("arrival_time")
    val operateDays = varchar("operate_days", 7)
    val durationMinutes = integer("duration_minutes")
    val stops = integer("stops")
    override val primaryKey = PrimaryKey(id)

    init {
        uniqueIndex(flightNumber)
    }
}

object ScheduledFlightsTable : Table("scheduled_flights") {
    val id = integer("id").autoIncrement()
    val scheduleId = reference("schedule_id", FlightSchedulesTable.id, onDelete = ReferenceOption.CASCADE)
    val departureTime = datetime("departure_time")
    val arrivalTime = datetime("arrival_time")
    val aircraftId = reference("aircraft_id", AircraftTable.id, onDelete = ReferenceOption.RESTRICT)
    val basePrice = decimal("base_price", 12, 2)
    val availableSeats = integer("available_seats").nullable()
    val status = varchar("status", 32)
    override val primaryKey = PrimaryKey(id)

    init {
        uniqueIndex(scheduleId, departureTime)
    }
}

object SeatsTable : Table("seats") {
    val id = integer("id").autoIncrement()
    val aircraftId = reference("aircraft_id", AircraftTable.id, onDelete = ReferenceOption.CASCADE)
    val seatNumber = varchar("seat_number", 16)
    val seatClass = varchar("seat_class", 32)
    override val primaryKey = PrimaryKey(id)

    init {
        uniqueIndex(aircraftId, seatNumber)
    }
}

object BookingsTable : Table("bookings") {
    val id = integer("id").autoIncrement()
    val userId = reference("user_id", UsersTable.id, onDelete = ReferenceOption.RESTRICT)
    val bookingReference = varchar("booking_reference", 64).uniqueIndex()
    val totalPrice = decimal("total_price", 12, 2)
    val status = varchar("status", 32)
    val createdAt = datetime("created_at")
    override val primaryKey = PrimaryKey(id)
}

object PassengersTable : Table("passengers") {
    val id = integer("id").autoIncrement()
    val bookingId = reference("booking_id", BookingsTable.id, onDelete = ReferenceOption.CASCADE)
    val firstName = varchar("first_name", 255).nullable()
    val lastName = varchar("last_name", 255).nullable()
    val email = varchar("email", 255).nullable()
    override val primaryKey = PrimaryKey(id)
}

object BookingFlightsTable : Table("booking_flights") {
    val id = integer("id").autoIncrement()
    val bookingId = reference("booking_id", BookingsTable.id, onDelete = ReferenceOption.CASCADE)
    val flightId = reference("flight_id", ScheduledFlightsTable.id, onDelete = ReferenceOption.RESTRICT)
    override val primaryKey = PrimaryKey(id)

    init {
        uniqueIndex(bookingId, flightId)
    }
}

object SeatAssignmentsTable : Table("seat_assignments") {
    val id = integer("id").autoIncrement()
    val passengerId = reference("passenger_id", PassengersTable.id, onDelete = ReferenceOption.CASCADE)
    val flightId = reference("flight_id", ScheduledFlightsTable.id, onDelete = ReferenceOption.RESTRICT)
    val seatId = reference("seat_id", SeatsTable.id, onDelete = ReferenceOption.RESTRICT)
    override val primaryKey = PrimaryKey(id)

    init {
        uniqueIndex(passengerId, flightId)
    }
}

object PaymentsTable : Table("payments") {
    val id = integer("id").autoIncrement()
    val bookingId = reference("booking_id", BookingsTable.id, onDelete = ReferenceOption.CASCADE)
    val amount = decimal("amount", 12, 2)
    val paymentMethod = varchar("payment_method", 64).nullable()
    val paymentStatus = varchar("payment_status", 32)
    val provider = varchar("provider", 64).nullable()
    val providerPaymentMethodId = varchar("provider_payment_method_id", 128).nullable()
    val cardholderName = varchar("cardholder_name", 255).nullable()
    val cardBrand = varchar("card_brand", 64).nullable()
    val cardLast4 = varchar("card_last4", 4).nullable()
    val expiryMonth = integer("expiry_month").nullable()
    val expiryYear = integer("expiry_year").nullable()
    val billingPostalCode = varchar("billing_postal_code", 32).nullable()
    val isDummy = bool("is_dummy")
    val transactionReference = varchar("transaction_reference", 128).nullable()
    val paymentDate = datetime("payment_date")
    override val primaryKey = PrimaryKey(id)
}

object ModificationRequestsTable : Table("modification_requests") {
    val id = integer("id").autoIncrement()
    val bookingId = reference("booking_id", BookingsTable.id, onDelete = ReferenceOption.CASCADE)
    val requestType = varchar("request_type", 32)
    val description = text("description").nullable()
    val status = varchar("status", 32)
    val createdAt = datetime("created_at")
    val processedBy = optReference("processed_by", UsersTable.id, onDelete = ReferenceOption.SET_NULL)
    override val primaryKey = PrimaryKey(id)
}

object ComplaintsTable : Table("complaints") {
    val id = integer("id").autoIncrement()
    val userId = reference("user_id", UsersTable.id, onDelete = ReferenceOption.CASCADE)
    val bookingId = optReference("booking_id", BookingsTable.id, onDelete = ReferenceOption.SET_NULL)
    val subject = varchar("subject", 255).nullable()
    val message = text("message").nullable()
    val status = varchar("status", 32)
    val createdAt = datetime("created_at")
    override val primaryKey = PrimaryKey(id)
}

object NotificationsTable : Table("notifications") {
    val id = integer("id").autoIncrement()
    val userId = reference("user_id", UsersTable.id, onDelete = ReferenceOption.CASCADE)
    val message = text("message").nullable()
    val isRead = bool("is_read")
    val createdAt = datetime("created_at")
    override val primaryKey = PrimaryKey(id)
}

object LoyaltyAccountsTable : Table("loyalty_accounts") {
    val id = integer("id").autoIncrement()
    val userId = reference("user_id", UsersTable.id, onDelete = ReferenceOption.CASCADE).uniqueIndex()
    val pointsBalance = integer("points_balance")
    val tier = varchar("tier", 32)
    override val primaryKey = PrimaryKey(id)
}

object LoyaltyRewardsTable : Table("loyalty_rewards") {
    val id = integer("id").autoIncrement()
    val rewardCode = varchar("reward_code", 64).uniqueIndex()
    val name = varchar("name", 255)
    val description = text("description")
    val pointsCost = integer("points_cost")
    val benefitType = varchar("benefit_type", 64)
    val benefitValue = varchar("benefit_value", 255).nullable()
    val tierRequired = varchar("tier_required", 32)
    val isActive = bool("is_active")
    val createdAt = datetime("created_at")
    override val primaryKey = PrimaryKey(id)
}

object LoyaltyTransactionsTable : Table("loyalty_transactions") {
    val id = integer("id").autoIncrement()
    val loyaltyAccountId = reference("loyalty_account_id", LoyaltyAccountsTable.id, onDelete = ReferenceOption.CASCADE)
    val bookingId = optReference("booking_id", BookingsTable.id, onDelete = ReferenceOption.SET_NULL)
    val pointsEarned = integer("points_earned")
    val pointsRedeemed = integer("points_redeemed")
    val transactionDate = datetime("transaction_date")
    override val primaryKey = PrimaryKey(id)
}

object LoyaltyRedemptionsTable : Table("loyalty_redemptions") {
    val id = integer("id").autoIncrement()
    val loyaltyAccountId = reference("loyalty_account_id", LoyaltyAccountsTable.id, onDelete = ReferenceOption.CASCADE)
    val rewardId = reference("reward_id", LoyaltyRewardsTable.id, onDelete = ReferenceOption.RESTRICT)
    val pointsSpent = integer("points_spent")
    val status = varchar("status", 32)
    val redemptionCode = varchar("redemption_code", 64).uniqueIndex()
    val benefitDetails = text("benefit_details").nullable()
    val redeemedAt = datetime("redeemed_at")
    val expiresAt = datetime("expires_at").nullable()
    override val primaryKey = PrimaryKey(id)
}
