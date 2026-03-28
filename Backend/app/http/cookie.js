const isProduction = () => String(process.env.NODE_ENV || "").trim().toLowerCase() === "production";

export const parseCookies = (cookieHeader) => {
    const header = String(cookieHeader || "").trim();
    if (!header) {
        return {};
    }

    return header.split(";").reduce((acc, part) => {
        const separatorIndex = part.indexOf("=");
        if (separatorIndex <= 0) {
            return acc;
        }

        const key = part.slice(0, separatorIndex).trim();
        const value = part.slice(separatorIndex + 1).trim();
        if (!key) {
            return acc;
        }

        acc[key] = decodeURIComponent(value);
        return acc;
    }, {});
};

export const buildSessionCookie = ({ name, value, maxAgeSeconds }) => {
    const segments = [
        `${name}=${encodeURIComponent(String(value || ""))}`,
        "Path=/",
        "HttpOnly",
        "SameSite=Lax",
        `Max-Age=${Math.max(0, Number(maxAgeSeconds) || 0)}`
    ];

    if (isProduction()) {
        segments.push("Secure");
    }

    return segments.join("; ");
};

export const buildClearedSessionCookie = (name) =>
    `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${isProduction() ? "; Secure" : ""}`;

