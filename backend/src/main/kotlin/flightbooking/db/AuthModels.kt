package flightbooking.db

import kotlinx.serialization.Serializable

@Serializable
data class RegisterRequest(
    val firstName: String,
    val lastName: String,
    val email: String,
    val password: String,
    val phone: String? = null,
)

@Serializable
data class LoginRequest(
    val email: String,
    val password: String,
)

@Serializable
data class AuthUser(
    val id: Int,
    val firstName: String? = null,
    val lastName: String? = null,
    val email: String,
    val phone: String? = null,
    val role: String = "customer",
)

@Serializable
data class AuthResponse(
    val token: String,
    val user: AuthUser,
)

@Serializable
data class ErrorResponse(
    val message: String,
)
