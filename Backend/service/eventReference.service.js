export const normalizeOperatingMode = (value) => {
    const mode = String(value || "").trim().toLowerCase();
    if (mode === "live") return "live";
    if (mode === "demo") return "demo";
    return null;
};

export const buildEventStkIdempotencyKey = ({ partnerName, eventId, userId }) =>
    `event-stk::${partnerName}::${eventId}::${String(userId)}`;

export const buildEventExternalRef = ({ partnerName, operatingMode, eventId }) =>
    `EVENT::${partnerName}::${operatingMode}::${eventId}`;

export const parseEventReference = (externalRef) => {
    const raw = String(externalRef || "").trim();
    if (!raw) {
        return null;
    }

    if (raw.startsWith("EVENT::")) {
        const parts = raw.split("::");
        if (parts.length >= 4) {
            const partnerName = String(parts[1] || "").trim();
            const operatingMode = normalizeOperatingMode(parts[2]);
            const eventId = String(parts.slice(3).join("::") || "").trim();
            if (partnerName && eventId && operatingMode) {
                return { partnerName, operatingMode, eventId };
            }
        }
        if (parts.length >= 3) {
            const partnerName = String(parts[1] || "").trim();
            const eventId = String(parts.slice(2).join("::") || "").trim();
            if (partnerName && eventId) {
                return { partnerName, eventId };
            }
        }
    }

    if (raw.startsWith("EVENT_")) {
        const eventId = String(raw.slice("EVENT_".length) || "").trim();
        if (eventId) {
            return { eventId };
        }
    }

    return null;
};
