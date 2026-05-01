import { useEffect, useState } from "react";
import { getLoyalty, redeemPoints } from "../services/api";
import { LoadingSpinner, ErrorMessage } from "../components/StatusMessages";
import { useAuth } from "../context/AuthContext";

const REWARD_OPTIONS = [
  { id: "voucher_10", label: "£10 Discount Voucher", points: 500, icon: "🎫" },
  { id: "voucher_25", label: "£25 Discount Voucher", points: 1200, icon: "🎫" },
  { id: "luggage", label: "Free Extra Luggage", points: 800, icon: "🧳" },
  { id: "upgrade", label: "Seat Upgrade", points: 1500, icon: "💺" },
  { id: "lounge", label: "Airport Lounge Pass", points: 2000, icon: "🛋️" },
];

const BENEFIT_ICONS = {
  voucher: "Ticket",
  baggage: "Bag",
  upgrade: "Upgrade",
  lounge: "Lounge",
};

export function RewardsPage({ onNavigate }) {
  const { user } = useAuth();
  const [loyalty, setLoyalty] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [redeeming, setRedeeming] = useState(null);
  const [redeemSuccess, setRedeemSuccess] = useState(null);

  useEffect(() => {
    if (authLoading) {
      setLoading(true);
      return;
    }

    if (!user) {
      setLoyalty(null);
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    async function fetchLoyalty() {
      try {
        const data = await getLoyalty();
        if (!cancelled) {
          setLoyalty(data);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchLoyalty();
    return () => {
      cancelled = true;
    };
  }, [authLoading, user]);

  async function handleRedeem(reward) {
    setRedeeming(reward.id);
    setRedeemSuccess(null);
    setError(null);

    const pointsCost = reward.pointsCost ?? reward.points;
    const rewardName = reward.name ?? reward.label ?? reward.display;

    try {
      const response = await redeemPoints({ rewardId: reward.id, pointsCost });
      const redemptionCode = response?.benefit?.redemptionCode;
      const redeemedName = response?.rewardName ?? rewardName;

      setRedeemSuccess(
        redemptionCode
          ? `${redeemedName} redeemed! Code: ${redemptionCode}`
          : `${redeemedName} redeemed! Check your email.`
      );

      if (response?.rewardName || response?.benefit) {
        const refreshed = await getLoyalty();
        if (refreshed) setLoyalty(refreshed);
      } else {
        setLoyalty((prev) => (prev ? { ...prev, points: prev.points - pointsCost } : prev));
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setRedeeming(null);
    }
  }

  const points = loyalty?.points ?? user?.loyaltyPoints ?? 0;
  const tier = loyalty?.tier ?? (points >= 5000 ? "Gold" : points >= 2000 ? "Silver" : "Bronze");
  const tierColor = { Gold: "#f0a500", Silver: "#94a3b8", Bronze: "#b87333" }[tier] || "#b87333";
  const rewards = loyalty?.rewards ?? REWARD_OPTIONS;
  const benefits = loyalty?.benefits ?? [];
  const nextTier = loyalty?.nextTier ?? (tier === "Bronze" ? "Silver" : tier === "Silver" ? "Gold" : null);
  const pointsToNextTier = loyalty?.pointsToNextTier ?? (tier === "Bronze" ? Math.max(0, 2000 - points) : tier === "Silver" ? Math.max(0, 5000 - points) : 0);

  return (
    <div className="page rewards-page">
      <div className="page-header">
        <h1>Loyalty & Rewards</h1>
        <p>Track your points, unlock tier perks, and redeem benefits for future trips.</p>
      </div>

      <div className="rewards-body">
        {authLoading && <LoadingSpinner message="Restoring your rewards..." />}
        {!authLoading && !user && !loading && (
          <div className="empty-state">
            <span className="empty-icon">*</span>
            <p>Sign in to view your points balance, available rewards, and redeemed benefits.</p>
            <button className="search-btn" onClick={() => onNavigate("login")}>Sign In</button>
          </div>
        )}
        {!authLoading && loading && <LoadingSpinner message="Loading your rewards..." />}
        {error && <ErrorMessage message={error} />}

        {!loading && !error && (
          <>
            <div className="points-card">
              <div className="points-tier" style={{ color: tierColor }}>
                {tier} Member
              </div>
              <div className="points-value">{points.toLocaleString()}</div>
              <div className="points-label">Available Points</div>
              <div className="points-lifetime">
                {(loyalty?.lifetimePoints ?? 0).toLocaleString()} lifetime points earned
              </div>
              <div className="tier-progress">
                <div className="tier-track">
                  <div
                    className="tier-fill"
                    style={{
                      width: `${Math.min(100, ((loyalty?.lifetimePoints ?? 0) / 5000) * 100)}%`,
                      background: tierColor,
                    }}
                  />
                </div>
                <span className="tier-next">
                  {nextTier
                    ? `${pointsToNextTier.toLocaleString()} pts to ${nextTier}`
                    : "Maximum tier reached!"}
                </span>
              </div>
            </div>

            {redeemSuccess && (
              <div className="confirmation-banner" style={{ marginBottom: "1.5rem" }}>
                <span className="confirm-icon">OK</span>
                <p>{redeemSuccess}</p>
                <button className="dismiss-btn" onClick={() => setRedeemSuccess(null)}>x</button>
              </div>
            )}

            <h2 className="rewards-section-title">Redeem Points</h2>
            <div className="rewards-grid">
              {rewards.map((reward) => {
                const pointsCost = reward.pointsCost ?? reward.points;
                const canAfford = points >= pointsCost;
                const canRedeem = reward.active !== false && (reward.unlocked ?? true) && canAfford;
                const buttonLabel = !reward.unlocked
                  ? `${reward.tierRequired} tier required`
                  : !canAfford
                    ? "Not enough points"
                    : redeeming === reward.id
                      ? "Redeeming..."
                      : "Redeem";

                return (
                  <div key={reward.id} className={`reward-card ${!canRedeem ? "reward-card--locked" : ""}`}>
                    <span className="reward-icon">{reward.icon ?? (BENEFIT_ICONS[reward.benefitType] || "Reward")}</span>
                    <h3 className="reward-name">{reward.name ?? reward.label ?? reward.display}</h3>
                    <div className="reward-points">{pointsCost.toLocaleString()} pts</div>
                    {reward.description && <p>{reward.description}</p>}
                    <button
                      className="redeem-btn"
                      disabled={!canRedeem || redeeming === reward.id}
                      onClick={() => handleRedeem(reward)}
                    >
                      {buttonLabel}
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="rewards-info" style={{ marginTop: "1.5rem" }}>
              <h2>Your Redeemed Benefits</h2>
              {benefits.length === 0 ? (
                <p>No benefits redeemed yet. Once you redeem a reward, your code and usage details will appear here.</p>
              ) : (
                <div className="earning-rules">
                  {benefits.map((benefit) => (
                    <div key={benefit.id} className="earning-rule">
                      <span>{BENEFIT_ICONS[benefit.benefitType] || "Benefit"}</span>
                      <div>
                        <strong>{benefit.rewardName}</strong>
                        <p>{benefit.message}</p>
                        <p>Code: {benefit.redemptionCode}</p>
                        <p>Status: {benefit.status}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rewards-info">
              <h2>How to earn points</h2>
              <div className="earning-rules">
                <div className="earning-rule">
                  <span>1x</span>
                  <div>
                    <strong>Economy flights</strong>
                    <p>Earn 1 point per GBP1 spent.</p>
                  </div>
                </div>
                <div className="earning-rule">
                  <span>2x</span>
                  <div>
                    <strong>Business class</strong>
                    <p>Earn 2 points per GBP1 spent.</p>
                  </div>
                </div>
                <div className="earning-rule">
                  <span>+500</span>
                  <div>
                    <strong>First booking bonus</strong>
                    <p>Your first completed member booking adds a 500 point welcome bonus.</p>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}