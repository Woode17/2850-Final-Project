package flightbooking.service

import flightbooking.db.table.LoyaltyAccountsTable
import flightbooking.db.table.UsersTable
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonIgnoreUnknownKeys
import org.jetbrains.exposed.sql.ResultRow
import org.jetbrains.exposed.sql.insert
import org.jetbrains.exposed.sql.selectAll
import org.jetbrains.exposed.sql.transactions.transaction
import org.jetbrains.exposed.sql.update
import org.mindrot.jbcrypt.BCrypt
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.time.LocalDateTime
import java.util.Base64

object AuthService {
    private val json = Json {
        ignoreUnknownKeys = true
    }

    @OptIn(ExperimentalSerializationApi::class)
    @Serializable
    @JsonIgnoreUnknownKeys
    data class RegisterRequest(
        val firstName: String = "",
        val lastName: String = "",
        val email: String = "",
        val phone: String = "",
        val password: String = "",
    )

    @OptIn(ExperimentalSerializationApi::class)
    @Serializable
    @JsonIgnoreUnknownKeys
    data class LoginRequest(
        val email: String = "",
        val password: String = "",
    )

    @Serializable
    data class AuthUser(
        val id: Int,
        val firstName: String = "",
        val lastName: String = "",
        val email: String,
        val phone: String = "",
        val role: String,
        val loyaltyPoints: Int = 0,
    )

    @Serializable
    data class AuthResponse(
        val token: String,
        val user: AuthUser,
    )

    fun register(requestBody: String): AuthResponse = transaction {
        val request = json.decodeFromString<RegisterRequest>(requestBody)
        val normalizedEmail = request.email.trim().lowercase()
        val password = request.password.trim()

        require(request.firstName.isNotBlank()) { "First name is required" }
        require(request.lastName.isNotBlank()) { "Last name is required" }
        require(normalizedEmail.isNotBlank()) { "Email is required" }
        require(password.length >= 8) { "Password must be at least 8 characters" }

        val existingUser = UsersTable.selectAll()
            .firstOrNull { it[UsersTable.email].equals(normalizedEmail, ignoreCase = true) }
        require(existingUser == null) { "An account with that email already exists" }

        val userId = UsersTable.insert { row ->
            row[firstName] = request.firstName.trim()
            row[lastName] = request.lastName.trim()
            row[email] = normalizedEmail
            row[passwordHash] = hashPassword(password)
            row[role] = "customer"
            row[createdAt] = LocalDateTime.now()
        }[UsersTable.id]

        LoyaltyAccountsTable.insert { row ->
            row[LoyaltyAccountsTable.userId] = userId
            row[pointsBalance] = 0
            row[tier] = "bronze"
        }

        val userRow = UsersTable.selectAll().first { it[UsersTable.id] == userId }
        AuthResponse(token = createToken(userId, normalizedEmail), user = userRow.toAuthUser())
    }

    fun login(requestBody: String): AuthResponse = transaction {
        val request = json.decodeFromString<LoginRequest>(requestBody)
        val normalizedEmail = request.email.trim().lowercase()
        val password = request.password.trim()

        val userRow = UsersTable.selectAll().firstOrNull {
            it[UsersTable.email].equals(normalizedEmail, ignoreCase = true)
        } ?: throw IllegalArgumentException("Invalid email or password")

        val storedHash = userRow[UsersTable.passwordHash]
        val isPasswordValid = verifyPassword(password, storedHash)
        if (!isPasswordValid) {
            throw IllegalArgumentException("Invalid email or password")
        }

        if (storedHash != null && isLegacySha256Hash(storedHash)) {
            UsersTable.update({ UsersTable.id eq userRow[UsersTable.id] }) { row ->
                row[passwordHash] = hashPassword(password)
            }
        }

        AuthResponse(
            token = createToken(userRow[UsersTable.id], userRow[UsersTable.email]),
            user = userRow.toAuthUser()
        )
    }

    fun getProfile(authorizationHeader: String?): AuthUser = transaction {
        val userId = resolveUserIdFromAuthorization(authorizationHeader)
            ?: throw IllegalArgumentException("Missing or invalid Authorization header")

        val userRow = UsersTable.selectAll().firstOrNull { it[UsersTable.id] == userId }
            ?: throw IllegalArgumentException("Invalid token")

        userRow.toAuthUser()
    }

    fun resolveUserIdFromAuthorization(authorizationHeader: String?): Int? {
        val token = extractBearerToken(authorizationHeader) ?: return null
        return parseUserId(token)
    }

    private fun ResultRow.toAuthUser(): AuthUser {
        val userId = this[UsersTable.id]
        val loyaltyPoints = LoyaltyAccountsTable.selectAll()
            .firstOrNull { it[LoyaltyAccountsTable.userId] == userId }
            ?.get(LoyaltyAccountsTable.pointsBalance)
            ?: 0

        return AuthUser(
            id = userId,
            firstName = this[UsersTable.firstName].orEmpty(),
            lastName = this[UsersTable.lastName].orEmpty(),
            email = this[UsersTable.email],
            phone = "",
            role = this[UsersTable.role],
            loyaltyPoints = loyaltyPoints,
        )
    }

    private fun extractBearerToken(authorizationHeader: String?): String? {
        if (authorizationHeader.isNullOrBlank()) return null
        val prefix = "Bearer "
        if (!authorizationHeader.startsWith(prefix, ignoreCase = true)) return null
        return authorizationHeader.substring(prefix.length).trim().takeIf { it.isNotBlank() }
    }

    private fun createToken(userId: Int, email: String): String {
        val payload = "leedsair:$userId:${email.lowercase()}"
        return Base64.getUrlEncoder().withoutPadding()
            .encodeToString(payload.toByteArray(StandardCharsets.UTF_8))
    }

    private fun parseUserId(token: String): Int? {
        val decoded = runCatching {
            String(Base64.getUrlDecoder().decode(token), StandardCharsets.UTF_8)
        }.getOrNull() ?: return null

        val parts = decoded.split(":")
        if (parts.size != 3 || parts[0] != "leedsair") return null
        return parts[1].toIntOrNull()
    }

    private fun hashPassword(password: String): String {
        return BCrypt.hashpw(password, BCrypt.gensalt())
    }

    private fun verifyPassword(password: String, storedHash: String?): Boolean {
        if (storedHash.isNullOrBlank()) return false
        return if (isLegacySha256Hash(storedHash)) {
            legacySha256(password) == storedHash
        } else {
            runCatching { BCrypt.checkpw(password, storedHash) }.getOrDefault(false)
        }
    }

    private fun isLegacySha256Hash(hash: String): Boolean =
        hash.length == 64 && hash.all { it.isDigit() || it.lowercaseChar() in 'a'..'f' }

    private fun legacySha256(password: String): String {
        val digest = MessageDigest.getInstance("SHA-256").digest(password.toByteArray(StandardCharsets.UTF_8))
        return digest.joinToString("") { "%02x".format(it) }
    }
}
