// 目标国家/地区配置。要扩展，往 COUNTRIES 里加一项即可。
// officialDomains 只用于两件事：给检索加 site: 限定、判断某个来源是否「官方」。
// 这里刻意不写任何法规名称——法规必须来自检索结果，不由配置预设。

export interface CountryConfig {
  code: string;
  name: string;
  nameEn: string;
  gl: string; // Serper 的国家参数
  lang: "zh" | "en" | "ja";
  officialDomains: string[];
}

export const COUNTRIES: CountryConfig[] = [
  { code: "CN", name: "中国大陆", nameEn: "Mainland China", gl: "cn", lang: "zh", officialDomains: ["gov.cn", "cac.gov.cn", "samr.gov.cn", "miit.gov.cn", "chinatax.gov.cn", "pbc.gov.cn", "npc.gov.cn"] },
  { code: "HK", name: "中国香港", nameEn: "Hong Kong", gl: "hk", lang: "zh", officialDomains: ["gov.hk", "pcpd.org.hk", "ird.gov.hk", "cr.gov.hk", "hkma.gov.hk", "elegislation.gov.hk"] },
  { code: "SG", name: "新加坡", nameEn: "Singapore", gl: "sg", lang: "en", officialDomains: ["gov.sg", "pdpc.gov.sg", "acra.gov.sg", "iras.gov.sg", "mas.gov.sg", "sso.agc.gov.sg", "imda.gov.sg"] },
  { code: "MY", name: "马来西亚", nameEn: "Malaysia", gl: "my", lang: "en", officialDomains: ["gov.my", "pdp.gov.my", "ssm.com.my", "hasil.gov.my", "bnm.gov.my", "mcmc.gov.my", "customs.gov.my"] },
  { code: "US", name: "美国", nameEn: "United States", gl: "us", lang: "en", officialDomains: [".gov", "ftc.gov", "irs.gov", "sba.gov", "oag.ca.gov", "cppa.ca.gov", "fda.gov", "sec.gov"] },
  { code: "GB", name: "英国", nameEn: "United Kingdom", gl: "uk", lang: "en", officialDomains: ["gov.uk", "ico.org.uk", "fca.org.uk", "legislation.gov.uk", "asa.org.uk", "cma.gov.uk"] },
  { code: "JP", name: "日本", nameEn: "Japan", gl: "jp", lang: "ja", officialDomains: ["go.jp", "ppc.go.jp", "nta.go.jp", "caa.go.jp", "fsa.go.jp", "meti.go.jp", "e-gov.go.jp"] },
  { code: "AE", name: "阿联酋", nameEn: "United Arab Emirates", gl: "ae", lang: "en", officialDomains: ["gov.ae", "u.ae", "tax.gov.ae", "difc.ae", "adgm.com", "tdra.gov.ae", "centralbank.ae"] },
  { code: "TW", name: "中国台湾", nameEn: "Taiwan", gl: "tw", lang: "zh", officialDomains: ["gov.tw", "law.moj.gov.tw", "ndc.gov.tw", "mof.gov.tw"] },
  { code: "KR", name: "韩国", nameEn: "South Korea", gl: "kr", lang: "en", officialDomains: ["go.kr", "pipc.go.kr", "nts.go.kr", "kftc.go.kr", "law.go.kr"] },
  { code: "AU", name: "澳大利亚", nameEn: "Australia", gl: "au", lang: "en", officialDomains: ["gov.au", "oaic.gov.au", "ato.gov.au", "asic.gov.au", "accc.gov.au", "legislation.gov.au"] },
  { code: "CA", name: "加拿大", nameEn: "Canada", gl: "ca", lang: "en", officialDomains: ["gc.ca", "canada.ca", "priv.gc.ca", "cra-arc.gc.ca"] },
  { code: "DE", name: "德国（欧盟）", nameEn: "Germany (EU)", gl: "de", lang: "en", officialDomains: ["bund.de", "bundesregierung.de", "europa.eu", "eur-lex.europa.eu", "edpb.europa.eu", "bfdi.bund.de"] },
  { code: "TH", name: "泰国", nameEn: "Thailand", gl: "th", lang: "en", officialDomains: ["go.th", "pdpc.or.th", "rd.go.th", "dbd.go.th"] },
  { code: "ID", name: "印度尼西亚", nameEn: "Indonesia", gl: "id", lang: "en", officialDomains: ["go.id", "kominfo.go.id", "pajak.go.id", "oss.go.id", "ojk.go.id"] },
];

export function getCountry(code: string): CountryConfig | undefined {
  return COUNTRIES.find((c) => c.code === code);
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

// 来源是否来自官方域名（任一国家）
export function isOfficialUrl(url: string): boolean {
  const host = hostOf(url);
  if (!host) return false;
  return COUNTRIES.some((c) =>
    c.officialDomains.some((d) => (d.startsWith(".") ? host.endsWith(d) : host === d || host.endsWith("." + d))),
  );
}
