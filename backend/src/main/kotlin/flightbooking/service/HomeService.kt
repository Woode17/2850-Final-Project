package flightbooking.service

import flightbooking.db.Airport
import flightbooking.db.DestinationDisplay
import flightbooking.db.HeroSlide
import flightbooking.db.HomeResponse
import flightbooking.db.LegalInfo
import flightbooking.db.Offer
import flightbooking.db.UserStatus
import flightbooking.db.table.AirportsTable
import flightbooking.db.table.FlightSchedulesTable
import flightbooking.db.table.ScheduledFlightsTable
import kotlinx.coroutines.withTimeoutOrNull
import org.jetbrains.exposed.sql.selectAll
import flightbooking.service.Airport as ApiAirport

object HomeService {
    private const val destinationCacheTtlMs = 5 * 60 * 1000L

    @Volatile
    private var cachedDestinations: List<DestinationDisplay>? = null

    @Volatile
    private var cachedDestinationsAt: Long = 0L

    fun getDestinations(): List<DestinationDisplay> {
        val now = System.currentTimeMillis()
        cachedDestinations?.takeIf { now - cachedDestinationsAt < destinationCacheTtlMs }?.let { return it }

        return org.jetbrains.exposed.sql.transactions.transaction {
            val allAirports = AirportsTable.selectAll().associateBy { it[AirportsTable.id] }
            val allSchedules = FlightSchedulesTable.selectAll().associateBy { it[FlightSchedulesTable.id] }

            val minPriceBySchedule =
                ScheduledFlightsTable.selectAll()
                    .groupBy { it[ScheduledFlightsTable.scheduleId] }
                    .mapValues { entry -> entry.value.minOf { it[ScheduledFlightsTable.basePrice].toDouble() } }

            val bookedFlightIds =
                flightbooking.db.table.BookingFlightsTable.selectAll()
                    .map { it[flightbooking.db.table.BookingFlightsTable.flightId] }

            val scheduledFlights = ScheduledFlightsTable.selectAll().associateBy { it[ScheduledFlightsTable.id] }
            val bookedScheduleIds = bookedFlightIds.mapNotNull { scheduledFlights[it]?.get(ScheduledFlightsTable.scheduleId) }
            val scheduleToArrival = allSchedules.mapValues { it.value[FlightSchedulesTable.arrivalAirportId] }

            val popularArrivals =
                bookedScheduleIds
                    .mapNotNull { scheduleToArrival[it] }
                    .groupingBy { it }
                    .eachCount()
                    .entries
                    .sortedByDescending { it.value }
                    .take(6)

            val results =
                popularArrivals.mapNotNull { (airportId, count) ->
                    val airport = allAirports[airportId] ?: return@mapNotNull null
                    val lowestPrice =
                        allSchedules.values
                            .asSequence()
                            .filter { it[FlightSchedulesTable.arrivalAirportId] == airportId }
                            .mapNotNull { minPriceBySchedule[it[FlightSchedulesTable.id]] }
                            .minOrNull()
                            ?: 0.0

                    DestinationDisplay(
                        city = airport[AirportsTable.city] ?: airport[AirportsTable.name] ?: "",
                        code = airport[AirportsTable.code],
                        price = lowestPrice,
                        flag = "",
                        bookingCount = count,
                        ariaLabel = "Flights to ${airport[AirportsTable.city] ?: airport[AirportsTable.name] ?: "Unknown"} starting from ${lowestPrice.toInt()} pounds",
                    )
                }

            val resolvedResults =
                if (results.isNotEmpty()) {
                    results
                } else {
                    listOf(
                        DestinationDisplay("Barcelona", "BCN", 89.0, "", ariaLabel = "Flights to Barcelona starting from 89 pounds"),
                        DestinationDisplay("Amsterdam", "AMS", 65.0, "", ariaLabel = "Flights to Amsterdam starting from 65 pounds"),
                        DestinationDisplay("Dubai", "DXB", 299.0, "", ariaLabel = "Flights to Dubai starting from 299 pounds"),
                        DestinationDisplay("Paris", "CDG", 74.0, "", ariaLabel = "Flights to Paris starting from 74 pounds"),
                    )
                }

            cachedDestinations = resolvedResults
            cachedDestinationsAt = now
            resolvedResults
        }
    }

    private fun ApiAirport.toDbAirport(): Airport =
        Airport(
            name,
            latitude_deg,
            longitude_deg,
            continent,
            iso_country,
            municipality,
            icao_code,
            iata_code,
            ariaLabel = "Nearest airport: $name in $municipality, $iso_country",
        )

    private val HeroSlides =
        listOf(
            HeroSlide(
                "Explore the Horizon",
                "Escape to your dream destination today",
                "Flights from $99",
                "https://images.unsplash.com/photo-1541432901042-2d8bd64b4a9b?auto=format&fit=crop&w=1200&q=80",
                "A scenic view of a city at sunset",
                "Start Searching",
                "/search",
                ariaLabel = "Hero slide: Explore the Horizon. Escape to your dream destination today. Flights from $99.",
            ),
        )

    private val BestOffers =
        listOf(
            Offer("New York Getaway", "From $499", 499.0, "USD", "JFK", "https://images.unsplash.com/photo-1496442226666-8d4d0e62e6e9?w=400", "New York skyline", "Return", ariaLabel = "Special offer: New York Getaway, Return flight from 499 USD to JFK"),
            Offer("Dubai Luxury", "From $450", 450.0, "USD", "DXB", "https://images.unsplash.com/photo-1512453979798-5ea266f8880c?w=400", "Burj Khalifa at night", "Return", ariaLabel = "Special offer: Dubai Luxury, Return flight from 450 USD to DXB"),
            Offer("Tokyo Blossom", "From $640", 640.0, "USD", "NRT", "https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e?w=400", "Traditional Tokyo street", "One way", ariaLabel = "Special offer: Tokyo Blossom, One way flight from 640 USD to NRT"),
            Offer("Barcelona Sun", "From $110", 110.0, "USD", "BCN", "https://images.unsplash.com/photo-1583422409516-2895a77efded?w=400", "Park Guell in Barcelona", "Return", ariaLabel = "Special offer: Barcelona Sun, Return flight from 110 USD to BCN"),
            Offer("Sydney Harbor", "From $920", 920.0, "USD", "SYD", "https://images.unsplash.com/photo-1506973035872-a4ec16b8e8d9?w=400", "Sydney Opera House", "Return", ariaLabel = "Special offer: Sydney Harbor, Return flight from 920 USD to SYD"),
            Offer("Amsterdam Canals", "From $95", 95.0, "USD", "AMS", "https://images.unsplash.com/photo-1512470876302-972faa2aa9a4?w=400", "Amsterdam canal view", "Each way", ariaLabel = "Special offer: Amsterdam Canals, Each way flight from 95 USD to AMS"),
        )

    suspend fun getHomeData(userIp: String?): HomeResponse {
        val loadedAirports = AirportLoader.loadFromCsv()
        val nearestAirport =
            userIp?.let { _ ->
                withTimeoutOrNull(800) {
                    null
                }
            } ?: loadedAirports.firstOrNull { airport -> airport.iata_code == "LBA" }?.toDbAirport()
                ?: loadedAirports.firstOrNull()?.toDbAirport()

        return HomeResponse(
            brandName = "FLIGHT BOOKING SYSTEM",
            user = UserStatus(false),
            nearestAirport = nearestAirport,
            heroSlides = HeroSlides,
            bestOffers = BestOffers,
            destinations = getDestinations().take(4),
            legal = LegalInfo(),
            navigation =
                mapOf(
                    "Experience" to listOf("Our Fleet", "Cabin Classes", "Lounge Access"),
                    "Book" to listOf("Flights", "Hotels", "Vacations"),
                    "Support" to listOf("Manage Booking", "Check-in", "Accessibility Help"),
                ),
        )
    }
}
