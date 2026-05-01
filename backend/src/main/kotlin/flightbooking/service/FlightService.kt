package flightbooking.service

import flightbooking.db.table.AirportsTable
import flightbooking.db.table.AircraftTable
import flightbooking.db.table.FlightSchedulesTable
import flightbooking.db.table.ScheduledFlightsTable
import kotlinx.serialization.Serializable
import org.jetbrains.exposed.sql.ResultRow
import org.jetbrains.exposed.sql.andWhere
import org.jetbrains.exposed.sql.SqlExpressionBuilder.eq
import org.jetbrains.exposed.sql.SqlExpressionBuilder.greaterEq
import org.jetbrains.exposed.sql.SqlExpressionBuilder.inList
import org.jetbrains.exposed.sql.SqlExpressionBuilder.less
import org.jetbrains.exposed.sql.selectAll
import org.jetbrains.exposed.sql.transactions.transaction
import java.time.Duration
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.format.DateTimeParseException
import kotlin.math.roundToInt

@Serializable
data class FlightResponse(
    val id: Int,
    val flightNumber: String,
    val airline: String,
    val from: String,
    val to: String,
    val departureTime: String,
    val arrivalTime: String,
    val departureDate: String,
    val duration: String,
    val stops: Int,
    val price: Int,
    val availableSeats: Int
)

object FlightService {
    fun searchFlights(from: String?, to: String?, departureDate: String?): List<FlightResponse> = transaction {
        val normalizedFrom = from?.trim()?.uppercase().takeUnless { it.isNullOrBlank() }
        val normalizedTo = to?.trim()?.uppercase().takeUnless { it.isNullOrBlank() }
        val parsedDate = departureDate?.trim().takeUnless { it.isNullOrBlank() }?.let {
            try {
                LocalDate.parse(it)
            } catch (_: DateTimeParseException) {
                null
            }
        }

        val airportsByCode = AirportsTable.selectAll().associateBy { it[AirportsTable.code].uppercase() }
        val departureAirportId = normalizedFrom?.let { code -> airportsByCode[code]?.get(AirportsTable.id) }
        val arrivalAirportId = normalizedTo?.let { code -> airportsByCode[code]?.get(AirportsTable.id) }

        if (normalizedFrom != null && departureAirportId == null) return@transaction emptyList()
        if (normalizedTo != null && arrivalAirportId == null) return@transaction emptyList()

        val scheduleQuery = FlightSchedulesTable.selectAll()
        if (departureAirportId != null) {
            scheduleQuery.andWhere { FlightSchedulesTable.departureAirportId eq departureAirportId }
        }
        if (arrivalAirportId != null) {
            scheduleQuery.andWhere { FlightSchedulesTable.arrivalAirportId eq arrivalAirportId }
        }

        val schedulesById = scheduleQuery.toList().associateBy { it[FlightSchedulesTable.id] }
        if (schedulesById.isEmpty()) return@transaction emptyList()

        val scheduledFlightsQuery = ScheduledFlightsTable.selectAll()
            .andWhere { ScheduledFlightsTable.scheduleId inList schedulesById.keys.toList() }

        if (parsedDate != null) {
            val startOfDay = parsedDate.atStartOfDay()
            val nextDay = parsedDate.plusDays(1).atStartOfDay()
            scheduledFlightsQuery.andWhere { ScheduledFlightsTable.departureTime greaterEq startOfDay }
            scheduledFlightsQuery.andWhere { ScheduledFlightsTable.departureTime less nextDay }
        }

        val airportsById = AirportsTable.selectAll().associateBy { it[AirportsTable.id] }
        val aircraftSeatMap = AircraftTable.selectAll().associate { row -> row[AircraftTable.id] to row[AircraftTable.totalSeats] }
        scheduledFlightsQuery
            .mapNotNull { row ->
                val schedule = schedulesById[row[ScheduledFlightsTable.scheduleId]] ?: return@mapNotNull null
                val departureAirport = airportsById[schedule[FlightSchedulesTable.departureAirportId]] ?: return@mapNotNull null
                val arrivalAirport = airportsById[schedule[FlightSchedulesTable.arrivalAirportId]] ?: return@mapNotNull null
                val departureCode = departureAirport[AirportsTable.code].uppercase()
                val arrivalCode = arrivalAirport[AirportsTable.code].uppercase()

                buildFlightResponse(
                    row = row,
                    schedule = schedule,
                    departureCode = departureCode,
                    arrivalCode = arrivalCode,
                    totalSeats = aircraftSeatMap[row[ScheduledFlightsTable.aircraftId]] ?: 189
                )
            }
            .sortedWith(compareBy<FlightResponse> { it.departureDate }.thenBy { it.departureTime }.thenBy { it.flightNumber })
    }

    private fun buildFlightResponse(
        row: ResultRow,
        schedule: ResultRow,
        departureCode: String,
        arrivalCode: String,
        totalSeats: Int
    ): FlightResponse {
        val departureDateTime = row[ScheduledFlightsTable.departureTime]
        val arrivalDateTime = row[ScheduledFlightsTable.arrivalTime]
        val availableSeats = row[ScheduledFlightsTable.availableSeats] ?: totalSeats
        val dynamicPrice = calculateDynamicPrice(
            basePrice = row[ScheduledFlightsTable.basePrice].toDouble(),
            departureDateTime = departureDateTime,
            availableSeats = availableSeats,
            totalSeats = totalSeats
        )

        return FlightResponse(
            id = row[ScheduledFlightsTable.id],
            flightNumber = schedule[FlightSchedulesTable.flightNumber],
            airline = schedule[FlightSchedulesTable.airline].ifBlank { "Demo Air" },
            from = departureCode,
            to = arrivalCode,
            departureTime = departureDateTime.toLocalTime().toString(),
            arrivalTime = arrivalDateTime.toLocalTime().toString(),
            departureDate = departureDateTime.toLocalDate().toString(),
            duration = formatDuration(departureDateTime, arrivalDateTime),
            stops = schedule[FlightSchedulesTable.stops],
            price = dynamicPrice.roundToInt(),
            availableSeats = availableSeats
        )
    }

    private fun calculateDynamicPrice(
        basePrice: Double,
        departureDateTime: LocalDateTime,
        availableSeats: Int,
        totalSeats: Int
    ): Double {
        val now = LocalDateTime.now()
        val hoursUntilDeparture = Duration.between(now, departureDateTime).toHours().coerceAtLeast(0)
        val daysUntilDeparture = hoursUntilDeparture / 24.0
        val seatsRatio = if (totalSeats <= 0) 1.0 else availableSeats.toDouble() / totalSeats.toDouble()

        val timeMultiplier = when {
            daysUntilDeparture > 60 -> 0.95
            daysUntilDeparture > 30 -> 1.0
            daysUntilDeparture > 14 -> 1.1
            daysUntilDeparture > 7 -> 1.2
            daysUntilDeparture > 3 -> 1.35
            daysUntilDeparture >= 1 -> 1.55
            else -> 1.8
        }

        val scarcityMultiplier = when {
            seatsRatio <= 0.10 -> 1.35
            seatsRatio <= 0.20 -> 1.20
            seatsRatio <= 0.35 -> 1.10
            else -> 1.0
        }

        val weekendMultiplier = when (departureDateTime.dayOfWeek) {
            java.time.DayOfWeek.FRIDAY,
            java.time.DayOfWeek.SATURDAY,
            java.time.DayOfWeek.SUNDAY -> 1.05
            else -> 1.0
        }

        return basePrice * timeMultiplier * scarcityMultiplier * weekendMultiplier
    }

    private fun formatDuration(
        departureDateTime: java.time.LocalDateTime,
        arrivalDateTime: java.time.LocalDateTime
    ): String {
        val minutes = Duration.between(departureDateTime, arrivalDateTime).toMinutes().coerceAtLeast(0)
        val hours = minutes / 60
        val remainingMinutes = minutes % 60
        return "${hours}h ${remainingMinutes}m"
    }
}
