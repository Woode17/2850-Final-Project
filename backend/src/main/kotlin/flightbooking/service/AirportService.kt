package flightbooking.service

import flightbooking.db.table.AirportsTable
import flightbooking.db.table.FlightSchedulesTable
import kotlinx.serialization.Serializable
import org.jetbrains.exposed.sql.andWhere
import org.jetbrains.exposed.sql.selectAll
import org.jetbrains.exposed.sql.transactions.transaction

@Serializable
data class Destination(
    val departure: String,
    val departureId: Int,
    val arrival: String,
    val arrivalId: Int,
)
@Serializable
data class Departure(
    val code: String,
    val city: String,
    val flag: String,
)

object AirportService {
    fun returnDepartureAirports(): List<Departure> { //Return all departure airports
        val schedules = FlightScheduleLoader.loadFromCsv()
        val airports = AirportLoader.loadFromCsv()
        val airportMap = airports.associateBy { it.iata_code.trim().uppercase() } //Create a hashmap for airports
        val departures = mutableSetOf<Departure>()

        for (schedule in schedules) {
            val airport = airportMap[schedule.from.trim().uppercase()] ?: continue
            departures.add(Departure(airport.iata_code.trim().uppercase(), airport.municipality.trim(), airport.iso_country.trim().uppercase()))
        }

        return departures.toList()
    }

    fun returnDestinations(from: String?): List<Destination> = transaction { //Return possible destination from specified airport
        val normalisedFrom = from?.trim()?.uppercase().takeUnless { it.isNullOrBlank() } //Normalise from String
        val airportsById = AirportsTable.selectAll().associateBy { it[AirportsTable.id] }
        val airportsByCode = AirportsTable.selectAll().associateBy { it[AirportsTable.code].uppercase() }
        val departureAirportId = normalisedFrom?.let { code -> airportsByCode[code]?.get(AirportsTable.id) }
        var scheduleQuery = FlightSchedulesTable.selectAll()

        if (departureAirportId != null) {
            scheduleQuery = scheduleQuery.andWhere { FlightSchedulesTable.departureAirportId eq departureAirportId }
        }

        val schedules = scheduleQuery.toList()

        return@transaction schedules.mapNotNull { schedule -> //Returns depId: Int, arrId: Int, depAirport: String, arrAirport: String
            val depId = schedule[FlightSchedulesTable.departureAirportId]
            val arrId = schedule[FlightSchedulesTable.arrivalAirportId]
            val depAirport = airportsById[depId] ?: return@mapNotNull null
            val arrAirport = airportsById[arrId] ?: return@mapNotNull null

            Destination(
                departure = depAirport[AirportsTable.code],
                departureId = depId,
                arrival = arrAirport[AirportsTable.code],
                arrivalId = arrId
            )
        }.distinctBy { it.departureId to it.arrivalId }  //Prevents duplicate flights
    }
}