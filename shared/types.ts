// 前后端共用的数据结构。方案里每条「论断」都带 sourceIds：
// 有有效来源 → 有来源的事实；为空 → 模型推断。

export interface Claim {
  text: string;
  sourceIds: string[];
}

export interface Source {
  id: string; // S1, S2 ...
  title: string;
  url: string;
  snippet: string;
  query: string;
  topic: string; // general | market | competitor | demand | <国家代码>
  official: boolean; // 域名属于政府/官方机构
}

export type ComplianceCategory =
  | "公司注册/主体"
  | "行业牌照"
  | "数据隐私"
  | "支付与税务"
  | "广告与平台规则"
  | "品类特殊监管";

export const COMPLIANCE_CATEGORIES: ComplianceCategory[] = [
  "公司注册/主体",
  "行业牌照",
  "数据隐私",
  "支付与税务",
  "广告与平台规则",
  "品类特殊监管",
];

export interface ComplianceItem {
  category: ComplianceCategory;
  requirement: string; // 无来源时固定为「待确认」
  checkHint: string; // 建议去哪查、查什么（不含法规名）
  sourceIds: string[];
  status: "有来源" | "待确认";
}

export interface CountryCompliance {
  country: string; // 国家代码
  countryName: string;
  items: ComplianceItem[];
  note: string;
}

export interface Competitor {
  name: string;
  description: string;
  url: string; // 仅允许来自检索来源，否则为空
  sourceIds: string[];
}

export interface PlanResult {
  clarification: {
    oneLiner: string;
    targetUsers: Claim[];
    painPoints: Claim[];
    scenarios: Claim[];
    questions: string[];
  };
  market: {
    sizeEstimate: Claim;
    assumptions: Claim[];
    competitors: Competitor[];
    demandSignals: (Claim & { platform: string })[];
  };
  compliance: CountryCompliance[];
  businessModel: {
    model: Claim;
    pricing: Claim[];
  };
  channels: (Claim & { cost: string })[];
  mvp: {
    include: string[];
    exclude: string[];
  };
  costTime: {
    items: { item: string; estimate: string }[];
    timeline: { phase: string; duration: string }[];
  };
  risks: { risk: string; mitigation: string }[];
  validation: { step: string; metric: string; threshold: string }[];
  verdict: {
    decision: "做" | "不做" | "先验证";
    reasons: Claim[];
  };
}

export type PlanStatus = "running" | "done" | "error";

export interface PlanRecord {
  id: number;
  ideaId: number;
  countries: string[];
  status: PlanStatus;
  stage: string;
  error: string | null;
  result: PlanResult | null;
  sources: Source[];
  warnings: string[];
  usage: { promptTokens: number; completionTokens: number; searches: number; cachedSearches: number };
  createdAt: string;
  finishedAt: string | null;
}

export interface IdeaRecord {
  id: number;
  text: string;
  createdAt: string;
}

export interface CountryInfo {
  code: string;
  name: string;
  nameEn: string;
}
