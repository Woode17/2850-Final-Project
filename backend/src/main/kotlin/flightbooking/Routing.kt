package flightbooking

import flightbooking.db.ErrorResponse
import flightbooking.db.LoginRequest
import flightbooking.db.RegisterRequest
import flightbooking.service.AuthService
import flightbooking.service.HomeService
import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.*
import io.ktor.server.request.receiveText
import io.ktor.server.response.*
import io.ktor.server.routing.*
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

fun Application.configureRouting() {
    routing {
        get("/") {
            call.respondText("Ktor environment is running.")
        }

        route("/api/auth") {
            post("/register") {
                val payload = call.receiveJsonOrNull<RegisterRequest>() ?: run {
                    call.respondJson(HttpStatusCode.BadRequest, ErrorResponse("Invalid request body."))
                    return@post
                }

                val email = payload.email.trim()
                if (email.isBlank() || payload.password.length < 8) {
                    call.respondJson(
                        HttpStatusCode.BadRequest,
                        ErrorResponse("Email is required and password must be at least 8 characters.")
                    )
                    return@post
                }

                val auth = AuthService.register(payload)
                if (auth == null) {
                    call.respondJson(HttpStatusCode.Conflict, ErrorResponse("Email already registered."))
                    return@post
                }
                call.respondJson(HttpStatusCode.Created, auth)
            }

            post("/login") {
                val payload = call.receiveJsonOrNull<LoginRequest>() ?: run {
                    call.respondJson(HttpStatusCode.BadRequest, ErrorResponse("Invalid request body."))
                    return@post
                }
                val auth = AuthService.login(payload)
                if (auth == null) {
                    call.respondJson(HttpStatusCode.Unauthorized, ErrorResponse("Invalid email or password."))
                    return@post
                }
                call.respondJson(HttpStatusCode.OK, auth)
            }

            get("/profile") {
                val token = call.extractBearerToken()
                if (token.isNullOrBlank()) {
                    call.respondJson(HttpStatusCode.Unauthorized, ErrorResponse("Missing Bearer token."))
                    return@get
                }

                val profile = AuthService.getProfileByToken(token)
                if (profile == null) {
                    call.respondJson(HttpStatusCode.Unauthorized, ErrorResponse("Invalid or expired token."))
                    return@get
                }
                call.respondJson(HttpStatusCode.OK, profile)
            }
        }

        // Landing Page API (Home)
        get("/api/home") {
            val userIp = call.request.local.remoteAddress
            call.respond(HomeService.getHomeData(userIp))
        }
    }
}

private val routingJson = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
}

private suspend inline fun <reified T> ApplicationCall.receiveJsonOrNull(): T? {
    val raw = runCatching { receiveText() }.getOrNull() ?: return null
    return runCatching { routingJson.decodeFromString<T>(raw) }.getOrNull()
}

private suspend inline fun <reified T> ApplicationCall.respondJson(status: HttpStatusCode, body: T) {
    respondText(
        text = routingJson.encodeToString(body),
        contentType = ContentType.Application.Json,
        status = status
    )
}

private fun ApplicationCall.extractBearerToken(): String? {
    val authHeader = request.headers["Authorization"] ?: return null
    if (!authHeader.startsWith("Bearer ")) return null
    return authHeader.removePrefix("Bearer ").trim().ifBlank { null }
}
