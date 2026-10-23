const fmt = new Intl.NumberFormat("en-NG", { maximumFractionDigits: 0 });

export const naira = (ngn: number) => `₦${fmt.format(ngn)}`;
export const koboToNaira = (kobo: number) => naira(Math.round(kobo / 100));
