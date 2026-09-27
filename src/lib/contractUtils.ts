import { CONTRACT_RISK_DAYS } from "./domainConstants";

export type ContractRiskLevel = "critical" | "warning" | "stable";

function parseContractDate(value: string): Date | null {
  // Some imported/saved squads contain a bare year (occasionally serialized as
  // "2026.0") instead of the usual YYYY-MM-DD contract date.
  const yearOnly = /^(\d{4})(?:\.0+)?$/.exec(value.trim());
  const normalized = yearOnly ? `${yearOnly[1]}-12-31` : value;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatContractEndDate(contractEnd: string | null): string | null {
  if (!contractEnd) return null;
  const yearOnly = /^(\d{4})(?:\.0+)?$/.exec(contractEnd.trim());
  if (yearOnly) return yearOnly[1];
  return parseContractDate(contractEnd) ? contractEnd : null;
}

export function getDaysUntil(targetDate: string, currentDate: string): number {
  const millisecondsPerDay = 1000 * 60 * 60 * 24;
  const target = parseContractDate(targetDate);
  const current = parseContractDate(currentDate);
  if (!target || !current) return 0;
  return Math.ceil(
    (target.getTime() - current.getTime()) / millisecondsPerDay,
  );
}

export function getContractRiskLevel(
  contractEnd: string | null,
  currentDate: string,
): ContractRiskLevel {
  if (!contractEnd) {
    return "stable";
  }

  if (!parseContractDate(contractEnd) || !parseContractDate(currentDate)) {
    return "stable";
  }

  const daysUntilExpiry = getDaysUntil(contractEnd, currentDate);

  if (daysUntilExpiry <= CONTRACT_RISK_DAYS.critical) {
    return "critical";
  }
  if (daysUntilExpiry <= CONTRACT_RISK_DAYS.warning) {
    return "warning";
  }
  return "stable";
}

export function getContractRiskBadgeVariant(
  level: ContractRiskLevel,
): "accent" | "success" | "danger" {
  if (level === "critical") {
    return "danger";
  }
  if (level === "warning") {
    return "accent";
  }
  return "success";
}

export function getContractDurationRemaining(
  contractEnd: string | null,
  currentDate: string,
): { years: number; months: number } | null {
  if (!contractEnd) {
    return null;
  }

  const end = parseContractDate(contractEnd);
  const current = parseContractDate(currentDate);
  if (!end || !current) return null;

  let months = Math.max(
    0,
    (end.getUTCFullYear() - current.getUTCFullYear()) * 12 +
      end.getUTCMonth() - current.getUTCMonth(),
  );
  const anchor = new Date(current);
  anchor.setUTCMonth(anchor.getUTCMonth() + months);
  if (anchor > end) months -= 1;
  return { years: Math.floor(months / 12), months: months % 12 };
}

export function getContractYearsRemaining(contractEnd: string | null, currentDate: string): string {
  const duration = getContractDurationRemaining(contractEnd, currentDate);
  if (!duration) return "—";
  const yearLabel = duration.years === 1 ? "año" : "años";
  const monthLabel = duration.months === 1 ? "mes" : "meses";
  if (duration.years === 0) return `${duration.months} ${monthLabel}`;
  if (duration.months === 0) return `${duration.years} ${yearLabel}`;
  return `${duration.years} ${yearLabel} ${duration.months} ${monthLabel}`;
}
