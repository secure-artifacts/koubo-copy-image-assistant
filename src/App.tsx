/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  Wand2, Download,
  Loader2, AlertCircle,
  Plus, Trash2, CheckCircle2,
  ChevronRight, ChevronLeft, Settings2,
  Square, CheckSquare, ShieldCheck, Type, Copy, Shuffle
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { getOpenRouterApiKey } from './utils/env';
import { ImageLibrary } from './components/ImageLibrary';
import {
  loadMatchMap, saveMatchMap, INTERNAL_IMAGE_MIME,
  type MatchMap, type LoadedImage,
} from './utils/imageMatch';
import { runCopyAudit, parseCopy, hasChinese } from './utils/copyAudit';
import JSZip from 'jszip';

// ── Word-level diff: computes markup from actual original vs corrected text ───
function buildMarkup(original: string, corrected: string): string {
  if (original === corrected) return original;
  const tokens = (s: string) => s.match(/[^\s]+|\s+/g) ?? [s];
  const orig = tokens(original);
  const corr = tokens(corrected);
  const n = orig.length, m = corr.length;
  const dp: number[][] = Array.from({length: n + 1}, () => Array(m + 1).fill(0));
  for (let i = 1; i <= n; i++)
    for (let j = 1; j <= m; j++)
      dp[i][j] = orig[i-1] === corr[j-1] ? dp[i-1][j-1] + 1 : Math.max(dp[i-1][j], dp[i][j-1]);
  const out: string[] = [];
  let i = n, j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && orig[i-1] === corr[j-1]) {
      out.unshift(orig[i-1]); i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j-1] >= dp[i-1][j])) {
      out.unshift(/^\s+$/.test(corr[j-1]) ? corr[j-1] : `**${corr[j-1]}**`); j--;
    } else {
      out.unshift(/^\s+$/.test(orig[i-1]) ? orig[i-1] : `~~${orig[i-1]}~~`); i--;
    }
  }
  return out.join('');
}

// ── Main app ──────────────────────────────────────────────────────────────────
export default function App() {
  const [isPasted, setIsPasted] = useState(false);
  const [copywriting, setCopywriting] = useState('');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isAuditing, setIsAuditing] = useState(false);
  const [auditProgress, setAuditProgress] = useState<string | null>(null);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [auditTechnicalError, setAuditTechnicalError] = useState<any>(null);
  const [retryStatus, setRetryStatus] = useState<{ attempt: number; total: number; nextRetryIn: number } | null>(null);
  const [currentBatchSize, setCurrentBatchSize] = useState(15);
  const [activeModelId, setActiveModelId] = useState("gemini-3-flash-preview");
  const [customBundleName, setCustomBundleName] = useState('');
  const [auditResults, setAuditResults] = useState<{
    id: string;
    chinese: string;
    originalEnglish: string;
    markupEnglish: string;
    correctedEnglish: string;
    qcEnglishHasChinese?: boolean;
  }[]>([]);
  const [auditSkippedAI, setAuditSkippedAI] = useState(false);
  const [selectedAuditOptions, setSelectedAuditOptions] = useState<Set<string>>(new Set(['spelling', 'case', 'punctuation', 'sequence']));
  const [auditInstructions, setAuditInstructions] = useState<Record<string, string>>({
    spelling: `仅纠正明显的拼写错误。
注意以下情况【不需要修改】：
- 圣经经文引用：不修改任何引用自圣经版本（KJV、NIV、ESV、NKJV 等）的文字，各版本有各自的用词规范。
- 全大写单词（如 AMEN、HALLELUJAH、LORD、JESUS、HOLY）：改为首字母大写（Title Case），例如 AMEN → Amen、HALLELUJAH → Hallelujah。
- 口语化缩写或非正式拼写（如 gonna、wanna、gotta）：口语文案，保持原样。
- 英式与美式拼写差异（如 Saviour/Savior、favour/favor、honour/honor、Alleluia/Hallelujah）：两种拼写均正确，不互相纠正。
- prophesy（动词）与 prophecy（名词）：词性不同，如两者混用则纠正，但各自本身拼写正确。
- 介词搭配：即使不符合书面语规范，口语中成立的搭配不修改。
- 风格润色：不做任何改写或润色。`,
    case: `仅纠正大小写错误。

【代词大小写 — 最重要的规则，必须先执行】
对 he/him/his/you/your/who/whom/whose 等代词，必须先判断指代对象：
- 指代上帝/耶稣/圣灵 → 应大写（He、Him、His、You、Your、Who…）
- 指代对象明确是人/天使/其他受造物 → 应小写
- 指代对象不明确、或短句中无足够上下文确认 → 【原样保留，不得改动】
- 原文已大写（如 He、His、Your）→ 除非能100%确认指代的是人，否则不得改为小写

【圣经版本引用 — 整段完全不动】
不同圣经译本（KJV、NKJV、NIV、ESV、NLT 等）各有自己的大小写规范，原文如此即正确：
- 含章节引用（如 John 3:16、Psalm 23:1）的句子
- 任何看起来像是圣经经文逐字引用的段落
- 以上情况中所有词的大小写，一律不改。

【可以纠正的情况】
1. 句子首字母明确缺失大写。
2. 神学专有名词（名称/称谓）的大小写：
   - 大写：God、Jesus、Christ、Lord、Father、Holy Spirit、Savior、Messiah、Creator、Redeemer、Almighty、Emmanuel、Immanuel、Lamb（指神的羔羊时）
   - Spirit：仅在明确指圣灵时大写（如 "the Holy Spirit"、"the Spirit of God"）；泛指人的灵性时不大写
   - 神学概念：Trinity、Resurrection、Ascension、Gospel、Cross、Heaven（指神居所时）、Kingdom（指神的国度时）、Church（指普世教会整体时）、Scripture、Bible、Word（指圣经或约翰福音"道成肉身"时）

【绝对不改的情况】
- 全大写单词（AMEN、HALLELUJAH、PRAISE、LORD 等）：改为首字母大写（Title Case），例如 AMEN → Amen、LORD → Lord（但圣经引用中的 LORD 不改）。
- 任何无法100%确认指代对象的代词：不改。
- 圣经版本引用中的任何词：不改。
- 介词搭配：不修改。`,
    punctuation: `仅纠正明显的标点错误（如句末缺少标点、引号不配对）。
如果一个完整句子（含主谓结构或完整语义）紧接着下一个句子但缺少句末标点，必须补上句号。

【引号配对检查 — 必须执行】
- 直双引号（"..."）：检查每个开引号是否有对应的闭引号，反之亦然。若不配对，补全缺失的一侧。
- 弯双引号（“...”）：同上，左引号（“）与右引号（”）必须成对出现。
- 直引号与弯引号混用：若同一对引号开头用弯引号、结尾用直引号（或相反），统一改为弯引号（“...”）。
- 单引号/撇号（'）在缩写中（如 it's、don't、I'm）：这是撇号，不属于引号配对，不修改。

注意以下情况【不需要修改】：
- 圣经经文引用：不修改引用自圣经版本的标点，各版本有各自的标点规范。
- 连续感叹号（如 !!!）或连续问号（如 ???）：口语情感强调，保持原样。
- 省略号（...）：用于口语停顿节奏，保持原样。
- 句子结构不完整（如 "Please Amen." "Thank You Jesus." "Holy is the Lord." "Blessed be His Name."）：基督教敬拜语言中成立的短句，不补全也不修改。
- 圣经章节引用（如 John 3:16、Genesis 1:1）中的冒号：这是章节引用格式，不是标点错误，保持原样。
- 介词搭配：不修改。`,
    sequence: '识别以数字序号（如 1, 2, 3）开头的段落。删除序号内部的多余空格和换行符，确保每个序号后紧跟完整的一段话。',
    custom: ''
  });

  const getCharCountColor = (count: number) => {
    if (count <= 299) return 'text-yellow-500';
    if (count >= 300 && count <= 420) return 'text-green-500';
    return 'text-red-500';
  };
  const [editingAuditId, setEditingAuditId] = useState<string | null>(null);
  const [tempAuditInstruction, setTempAuditInstruction] = useState('');
  const [showAuditModal, setShowAuditModal] = useState(false);
  const [matchingEngine, setMatchingEngine] = useState<'gemini' | 'openrouter' | 'meta'>('gemini');
  const [geminiApiKey, setGeminiApiKey] = useState('');
  const [openRouterApiKey, setOpenRouterApiKey] = useState('');
  const [metaApiKey, setMetaApiKey] = useState('');
  const [openRouterModels, setOpenRouterModels] = useState<any[]>([]);
  const [openRouterModelsError, setOpenRouterModelsError] = useState<string | null>(null);
  const [selectedModelId, setSelectedModelId] = useState('google/gemini-flash-1.5-exp:free');
  const [geminiModels, setGeminiModels] = useState<{ id: string; label: string }[]>([]);
  const [geminiModelsError, setGeminiModelsError] = useState<string | null>(null);
  const [selectedGeminiModel, setSelectedGeminiModel] = useState('gemini-2.5-flash');
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(false);
  const [selectedAuditIds, setSelectedAuditIds] = useState<Set<string>>(new Set());
  const [cardDragOver, setCardDragOver] = useState<string | null>(null);
  const [copiedAuditTextKeys, setCopiedAuditTextKeys] = useState<Set<string>>(new Set());
  const [matchMap, setMatchMap] = useState<MatchMap>({});
  const [matchMapLoaded, setMatchMapLoaded] = useState(false);
  const [libraryImages, setLibraryImages] = useState<LoadedImage[]>([]);
  const [libraryFolderName, setLibraryFolderName] = useState<string>('');
  const [voiceId, setVoiceId] = useState<string>('');
  const [voiceEngine, setVoiceEngine] = useState<string>('auto');
  const [voiceSpeed, setVoiceSpeed] = useState<string>('1.0');
  const fileByName = useMemo(() => {
    const m: Record<string, LoadedImage> = {};
    for (const img of libraryImages) m[img.name] = img;
    return m;
  }, [libraryImages]);
  const [lastSaved, setLastSaved] = useState<string | null>(null);

  // Fetch OpenRouter models on mount
  useEffect(() => {
    const fetchModels = async () => {
      setOpenRouterModelsError(null);
      try {
        const res = await fetch('https://openrouter.ai/api/v1/models');
        if (!res.ok) {
          throw new Error(`HTTP Error ${res.status}`);
        }
        const data = await res.json();
        // Filter for free multimodal models (simplified check)
        const freeModels = data.data.filter((m: any) => 
          m.pricing.prompt === "0" && 
          (m.description?.toLowerCase().includes('vision') || m.name?.toLowerCase().includes('vision') || m.id?.includes('gemini') || m.id?.includes('claude-3') || m.id?.includes('pixtral'))
        );
        setOpenRouterModels(freeModels);
        if (freeModels.length > 0) setSelectedModelId(freeModels[0].id);
      } catch (err) {
        console.error("Failed to fetch OpenRouter models", err);
        setOpenRouterModelsError("加载外接模型列表失败，请检查网络限制。已回退到默认体验模型。");
      }
    };
    fetchModels();
  }, []);

  // Fetch the Gemini model list for the audit dropdown, using the user's own key.
  // Runs whenever the key changes so newly-released models (e.g. 3.x) appear automatically.
  useEffect(() => {
    if (matchingEngine !== 'gemini' || !geminiApiKey) return;
    let cancelled = false;
    (async () => {
      setGeminiModelsError(null);
      try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${geminiApiKey}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const models = (data.models ?? [])
          .filter((m: any) =>
            m.supportedGenerationMethods?.includes('generateContent') &&
            /(^|\/)gemini/i.test(m.name) &&
            !/embedding|aqa|imagen|image-generation|tts|native-audio/i.test(m.name)
          )
          .map((m: any) => {
            const id = m.name.replace(/^models\//, '');
            return { id, label: m.displayName ? `${m.displayName} (${id})` : id };
          })
          .sort((a: { id: string }, b: { id: string }) =>
            b.id.localeCompare(a.id, undefined, { numeric: true })
          );
        if (cancelled) return;
        setGeminiModels(models);
        setSelectedGeminiModel(prev =>
          models.some((m: { id: string }) => m.id === prev) ? prev : (models[0]?.id ?? prev)
        );
      } catch (e) {
        if (!cancelled) setGeminiModelsError('加载 Gemini 模型列表失败，使用默认模型质检。');
      }
    })();
    return () => { cancelled = true; };
  }, [geminiApiKey, matchingEngine]);

  // Load API Keys from localStorage on mount
  useEffect(() => {
    const savedORKey = localStorage.getItem('openrouter-api-key');
    if (savedORKey) setOpenRouterApiKey(savedORKey);

    const savedGeminiKey = localStorage.getItem('gemini-api-key');
    if (savedGeminiKey) setGeminiApiKey(savedGeminiKey);

    const savedMetaKey = localStorage.getItem('meta-api-key');
    if (savedMetaKey) setMetaApiKey(savedMetaKey);

    const savedCopywriting = localStorage.getItem('copy-matcher-copywriting');
    if (savedCopywriting) setCopywriting(savedCopywriting);

    const savedAuditResults = localStorage.getItem('copy-matcher-audit-results');
    if (savedAuditResults) {
      try {
        setAuditResults(JSON.parse(savedAuditResults));
      } catch (e) {
        console.error("Failed to parse audit results", e);
      }
    }

    const savedCopiedAuditTextKeys = localStorage.getItem('copy-matcher-copied-audit-text-keys');
    if (savedCopiedAuditTextKeys) {
      try {
        setCopiedAuditTextKeys(new Set(JSON.parse(savedCopiedAuditTextKeys)));
      } catch (e) {
        console.error("Failed to parse copied audit text keys", e);
      }
    }

    const savedAuditOptions = localStorage.getItem('copy-matcher-audit-options');
    if (savedAuditOptions) {
      try {
        setSelectedAuditOptions(new Set(JSON.parse(savedAuditOptions)));
      } catch (e) {
        console.error("Failed to parse audit options", e);
      }
    }

    const savedAuditInstructions = localStorage.getItem('copy-matcher-audit-instructions');
    if (savedAuditInstructions) {
      try {
        setAuditInstructions(JSON.parse(savedAuditInstructions));
      } catch (e) {
        console.error("Failed to parse audit instructions", e);
      }
    }

    const savedEngine = localStorage.getItem('copy-matcher-engine');
    if (savedEngine) setMatchingEngine(savedEngine as 'gemini' | 'openrouter' | 'meta');

    const savedModel = localStorage.getItem('copy-matcher-model');
    if (savedModel) setSelectedModelId(savedModel);

    const savedGeminiModel = localStorage.getItem('copy-matcher-gemini-model');
    if (savedGeminiModel) setSelectedGeminiModel(savedGeminiModel);
  }, []);

  // Load persisted image-match map from IndexedDB
  useEffect(() => {
    loadMatchMap().then(m => {
      setMatchMap(m);
      setMatchMapLoaded(true);
    }).catch(() => setMatchMapLoaded(true));
  }, []);

  // Persist match map whenever it changes (skip first load before hydration)
  useEffect(() => {
    if (!matchMapLoaded) return;
    saveMatchMap(matchMap).catch(e => console.warn('Failed to save match map', e));
  }, [matchMap, matchMapLoaded]);

  // Build the File[] payload when an audit row's image slot is dragged out.
  // If the row is part of a multi-row selection, bundle every selected row
  // that has a matched image (in audit-list order). Otherwise just this row.
  const collectDragFiles = (originId: string): File[] => {
    const ids = selectedAuditIds.has(originId) && selectedAuditIds.size > 1
      ? auditResults.map(r => r.id).filter(id => selectedAuditIds.has(id))
      : [originId];
    const out: File[] = [];
    const seen = new Set<File>();
    for (const id of ids) {
      const name = matchMap[id];
      if (!name) continue;
      const img = fileByName[name];
      if (!img || seen.has(img.file)) continue;
      seen.add(img.file);
      out.push(img.file);
    }
    return out;
  };

  // Drop stale entries when audit results change (id no longer present)
  useEffect(() => {
    if (!matchMapLoaded) return;
    const validIds = new Set(auditResults.map(r => r.id));
    setMatchMap(prev => {
      let changed = false;
      const next: MatchMap = {};
      for (const [id, name] of Object.entries(prev) as [string, string][]) {
        if (validIds.has(id)) next[id] = name;
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [auditResults, matchMapLoaded]);

  // Persistence effects
  useEffect(() => {
    try {
      localStorage.setItem('copy-matcher-copywriting', copywriting);
      setLastSaved(new Date().toLocaleTimeString());
    } catch (e) {
      console.warn("Failed to save copywriting", e);
    }
  }, [copywriting]);

  useEffect(() => {
    try {
      localStorage.setItem('copy-matcher-audit-results', JSON.stringify(auditResults));
      setLastSaved(new Date().toLocaleTimeString());
    } catch (e) {
      console.warn("Failed to save audit results", e);
    }
  }, [auditResults]);

  useEffect(() => {
    try {
      localStorage.setItem('copy-matcher-audit-options', JSON.stringify(Array.from(selectedAuditOptions)));
    } catch (e) {
      console.warn("Failed to save audit options", e);
    }
  }, [selectedAuditOptions]);

  useEffect(() => {
    try {
      localStorage.setItem('copy-matcher-copied-audit-text-keys', JSON.stringify(Array.from(copiedAuditTextKeys)));
    } catch (e) {
      console.warn("Failed to save copied audit text keys", e);
    }
  }, [copiedAuditTextKeys]);

  useEffect(() => {
    try {
      localStorage.setItem('copy-matcher-audit-instructions', JSON.stringify(auditInstructions));
    } catch (e) {
      console.warn("Failed to save audit instructions", e);
    }
  }, [auditInstructions]);


  useEffect(() => {
    try {
      localStorage.setItem('copy-matcher-engine', matchingEngine);
    } catch (e) {
      console.warn("Failed to save engine setting", e);
    }
  }, [matchingEngine]);

  useEffect(() => {
    try {
      localStorage.setItem('copy-matcher-model', selectedModelId);
    } catch (e) {
      console.warn("Failed to save model setting", e);
    }
  }, [selectedModelId]);

  useEffect(() => {
    try {
      localStorage.setItem('copy-matcher-gemini-model', selectedGeminiModel);
    } catch (e) {
      console.warn("Failed to save Gemini model setting", e);
    }
  }, [selectedGeminiModel]);

  const saveOpenRouterKey = (key: string) => {
    setOpenRouterApiKey(key);
    localStorage.setItem('openrouter-api-key', key);
  };

  const saveGeminiKey = (key: string) => {
    setGeminiApiKey(key);
    localStorage.setItem('gemini-api-key', key);
  };

  const saveMetaKey = (key: string) => {
    setMetaApiKey(key);
    localStorage.setItem('meta-api-key', key);
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const pastedText = e.clipboardData.getData('text');
    // Just update the state, don't trigger auto-audit anymore
    if (/^\s*\d+[\s.]/.test(pastedText)) {
      setCopywriting(pastedText);
    }
    setIsPasted(true);
    setTimeout(() => setIsPasted(false), 2000);
  };

  // Helper for retrying API calls with exponential backoff
  const generateTraceId = () => {
    return Math.random().toString(36).substring(2, 10).toUpperCase();
  };

  const normalizeError = (error: any) => {
    const rawMessage = error.message || String(error);
    const traceId = generateTraceId();
    
    // Technical categorization
    let category: '502' | '503' | '429' | 'timeout' | 'safety' | 'quota' | 'unknown' = 'unknown';
    let suggestion = "请稍后重试或检查网络连接。";
    
    const cleanMessage = rawMessage.replace(/<[^>]*>?/gm, ''); // Strip HTML tags
    
    if (cleanMessage.includes('502')) {
      category = '502';
      suggestion = "服务器网关错误，可能是暂时性的负载过高，请重试。";
    } else if (cleanMessage.includes('503') || cleanMessage.includes('UNAVAILABLE')) {
      category = '503';
      suggestion = "服务暂时不可用，AI 建议您等待几秒后再次尝试。";
    } else if (cleanMessage.includes('429') || cleanMessage.includes('RESOURCE_EXHAUSTED')) {
      category = '429';
      suggestion = "请求过于频繁，已达到 API 限额。我们将自动为您执行退避重试。";
    } else if (cleanMessage.toLowerCase().includes('timeout') || cleanMessage.includes('超时')) {
      category = 'timeout';
      suggestion = "请求响应超时，可能是文案批处理过大。我们将自动缩小请求规模并重试。";
    } else if (cleanMessage.toLowerCase().includes('safety') || cleanMessage.includes('安全')) {
      category = 'safety';
      suggestion = "内容可能触发了 AI 安全策略。请尝试修改文案内容。";
    } else if (cleanMessage.toLowerCase().includes('quota')) {
      category = 'quota';
      suggestion = "API 额度已耗尽。请检查您的 API Key 或稍后再试。";
    }

    return {
      category,
      message: cleanMessage,
      suggestion,
      traceId,
      raw: error
    };
  };

  const callWithRetry = async (
    fn: () => Promise<any>, 
    maxRetries = 3, 
    initialDelay = 2000,
    onRetry?: (attempt: number, nextRetryIn: number) => void
  ) => {
    let lastError;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error: any) {
        lastError = error;
        const normalized = normalizeError(error);
        const isRetryable = ['502', '503', '429', 'timeout'].includes(normalized.category);
        
        if (isRetryable && attempt < maxRetries - 1) {
          // Exponential backoff with jitter
          const baseDelay = initialDelay * Math.pow(2, attempt);
          const jitter = Math.random() * 1000;
          const delay = baseDelay + jitter;
          
          if (onRetry) onRetry(attempt + 1, Math.round(delay / 1000));
          
          console.log(`[Trace:${normalized.traceId}] API retry ${attempt + 1}/${maxRetries} in ${Math.round(delay)}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        throw error;
      }
    }
    throw lastError;
  };

  // Calls the public Gemini API directly with the user's own key — no Vertex/backend involved.
  const callGeminiDirect = async (prompt: string): Promise<string> => {
    if (!geminiApiKey) throw new Error('请先填写 Gemini API Key');
    const candidates = [selectedGeminiModel, 'gemini-2.5-flash', 'gemini-2.5-flash-lite']
      .filter((m, i, a) => !!m && a.indexOf(m) === i);
    let lastErr: any = new Error('No models tried');
    for (const model of candidates) {
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiApiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: { responseMimeType: 'application/json' },
            }),
          }
        );
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error?.message || `Gemini API error ${res.status}`);
        }
        const data = await res.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) throw new Error('Gemini 返回了空响应。');
        return text;
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr;
  };

  const callOpenRouterText = async (prompt: string): Promise<string> => {
    const apiKey = openRouterApiKey || getOpenRouterApiKey();
    if (!apiKey) throw new Error('请先填写 OpenRouter API Key');
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': window.location.origin,
        'X-Title': 'AI Copy Matcher',
      },
      body: JSON.stringify({
        model: selectedModelId,
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
      }),
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error?.message || `OpenRouter Error: ${response.status}`);
    }
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('OpenRouter 返回了空响应。');
    return content;
  };

  const META_API_URL = 'https://api.meta.ai/v1/chat/completions';
  const META_MODEL_ID = 'muse-spark-1.1';

  // Meta AI Model API — OpenAI-compatible chat completions endpoint.
  const callMetaText = async (prompt: string): Promise<string> => {
    if (!metaApiKey) throw new Error('请先填写 Meta AI API Key');
    const response = await fetch(META_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${metaApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: META_MODEL_ID,
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
      }),
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error?.message || `Meta AI Error: ${response.status}`);
    }
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('Meta AI 返回了空响应。');
    return content;
  };

  // No user API key for the selected engine → formatting-only mode: parse &
  // segment locally, skip the AI audit call entirely.
  const hasAuditKey = matchingEngine === 'gemini'
    ? !!geminiApiKey
    : matchingEngine === 'meta'
    ? !!metaApiKey
    : !!(openRouterApiKey || getOpenRouterApiKey());

  const handleAuditCopy = async (overrideText?: string) => {
    const textToProcess = overrideText || copywriting;
    if (!textToProcess) return;

    setIsAuditing(true);
    setAuditError(null);
    setAuditTechnicalError(null);
    setRetryStatus(null);
    setAuditResults([]);
    setCopiedAuditTextKeys(new Set());
    setActiveModelId(
      matchingEngine === 'gemini' ? selectedGeminiModel
      : matchingEngine === 'meta' ? META_MODEL_ID
      : selectedModelId
    );
    setAuditSkippedAI(!hasAuditKey);

    if (!hasAuditKey) {
      setAuditProgress('排版中…');
      try {
        const results = parseCopy(textToProcess)
          .filter((s) => s.english.trim() || s.chinese.trim())
          .map((s) => ({
            id: s.id,
            chinese: s.chinese,
            originalEnglish: s.english,
            markupEnglish: s.english,
            correctedEnglish: s.english,
            qcEnglishHasChinese: hasChinese(s.english),
          }));
        setAuditResults(results);
      } catch (error: any) {
        const normalized = normalizeError(error);
        setAuditError(normalized.suggestion);
        setAuditTechnicalError(normalized);
      } finally {
        setIsAuditing(false);
        setAuditProgress(null);
        setRetryStatus(null);
      }
      return;
    }

    setAuditProgress('校验中…');

    try {
      const callModel =
        matchingEngine === 'gemini' ? callGeminiDirect
        : matchingEngine === 'meta' ? callMetaText
        : callOpenRouterText;
      const results = await runCopyAudit(
        textToProcess,
        Array.from(selectedAuditOptions),
        auditInstructions,
        (prompt) => callWithRetry(
          () => callModel(prompt),
          3, 2000,
          (attempt, nextIn) => setRetryStatus({ attempt, total: 3, nextRetryIn: nextIn })
        ),
        (batch, total) => setAuditProgress(`${batch} / ${total}`)
      );
      setAuditResults(results);
    } catch (error: any) {
      const normalized = normalizeError(error);
      setAuditError(normalized.suggestion);
      setAuditTechnicalError(normalized);
    } finally {
      setIsAuditing(false);
      setAuditProgress(null);
      setRetryStatus(null);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const CopyButton = ({ text, label }: { text: string, label?: string }) => {
    const [copied, setCopied] = useState(false);
    
    const handleCopy = (e: React.MouseEvent) => {
      e.stopPropagation();
      navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    };

    return (
      <button 
        onClick={handleCopy}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl transition-all group relative border ${
          copied ? 'bg-red-50 border-red-200 shadow-sm' : 'hover:bg-neutral-50 border-transparent hover:border-neutral-200'
        }`}
      >
        <AnimatePresence mode="wait">
          {copied ? (
            <motion.div
              key="check"
              initial={{ scale: 0.8, opacity: 0, y: 5 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.8, opacity: 0, y: -5 }}
              className="flex items-center gap-1.5 text-red-600 font-bold text-[10px]"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>已复制</span>
            </motion.div>
          ) : (
            <motion.div
              key="copy"
              initial={{ scale: 0.8, opacity: 0, y: 5 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.8, opacity: 0, y: -5 }}
              className="flex items-center gap-1.5 text-neutral-400 group-hover:text-red-600 font-bold text-[10px]"
            >
              <Copy className="w-3.5 h-3.5" />
              {label && <span>{label}</span>}
            </motion.div>
          )}
        </AnimatePresence>
      </button>
    );
  };

  const CopyableText = ({ text, children, className = "", hasBeenCopied = false, onCopy }: { text: string, children: React.ReactNode, className?: string, hasBeenCopied?: boolean, onCopy?: () => void }) => {
    const [copied, setCopied] = useState(false);
    
    const handleCopy = (e: React.MouseEvent) => {
      e.stopPropagation();
      navigator.clipboard.writeText(text);
      setCopied(true);
      onCopy?.();
      setTimeout(() => setCopied(false), 2000);
    };

    return (
      <div
        onClick={handleCopy}
        className={`relative cursor-pointer group transition-all duration-300 ${className} ${
          copied ? 'ring-2 ring-red-400 ring-offset-2' : ''
        } ${hasBeenCopied ? '[&_div]:!text-rose-900 [&_span]:!text-rose-900' : ''}`}
      >
        <div className={`transition-all duration-300 ${copied ? 'bg-red-100/50 text-red-700' : ''}`}>
          {children}
        </div>
        <AnimatePresence>
          {copied && (
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: -10 }}
              className="absolute inset-0 flex items-center justify-center bg-red-600/10 backdrop-blur-[1px] rounded-2xl pointer-events-none"
            >
              <div className="bg-red-600 text-white px-3 py-1 rounded-full text-[10px] font-bold shadow-lg flex items-center gap-1.5">
                <CheckCircle2 className="w-3 h-3" />
                已复制内容
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  };

  const normalizeChinese = (text: string) => text.replace(/\s*\n\s*/g, ' ').trim();
  const normalizeEnglish = (text: string) => text.replace(/\s*\n\s*/g, ' ').trim();

  // Safe on both Windows (forbids \ / : * ? " < > |) and macOS (forbids / and null)
  const sanitizeFilename = (text: string, maxChars = 50): string =>
    text
      .slice(0, maxChars)
      .replace(/[\\/:*?"<>|]/g, '')
      .replace(/[\x00-\x1f\x7f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/[. ]+$/, '');

  const triggerDownload = (url: string, filename: string) => {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const [isBundling, setIsBundling] = useState(false);
  const [unmatchedWarning, setUnmatchedWarning] = useState<{ ids: string[] } | null>(null);

  const randomMatch = () => {
    if (libraryImages.length === 0) {
      alert('请先在右侧选择图片库文件夹。');
      return;
    }
    const unmatched = auditResults.filter(r => !fileByName[matchMap[r.id]]);
    if (unmatched.length === 0) return;

    const shuffled = libraryImages.map(img => img.name);
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    setMatchMap(prev => {
      const next = { ...prev };
      unmatched.forEach((r, idx) => {
        next[r.id] = shuffled[idx % shuffled.length];
      });
      return next;
    });
  };

  const bundleDownload = () => {
    if (auditResults.length === 0 || isBundling) return;
    const unmatchedIds = auditResults.filter(r => !fileByName[matchMap[r.id]]).map(r => r.id);
    if (unmatchedIds.length > 0) {
      setUnmatchedWarning({ ids: unmatchedIds });
      return;
    }
    performBundleDownload();
  };

  const performBundleDownload = async () => {
    if (auditResults.length === 0 || isBundling) return;
    setIsBundling(true);

    try {
      const zip = new JSZip();
      const ts = new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '');

      // 1. copy file
      const header = `voice_id\t${voiceId}\nvoice_engine\t${voiceEngine}\nvoice_speed\t${voiceSpeed}`;
      const colNames = `#id#\tchinese\tenglish`;
      const rows = auditResults.map(r => [`#${r.id}#`, normalizeChinese(r.chinese), normalizeEnglish(r.correctedEnglish)].join('\t'));
      const content = [header, colNames, ...rows].join('\n');
      zip.file('copy.tsv', content);

      // 2. matched images — renamed
      const images = zip.folder('images')!;
      const matchedNames = new Set<string>();
      for (const r of auditResults) {
        const img = fileByName[matchMap[r.id]];
        if (!img) continue;
        matchedNames.add(img.name);
        const ext = img.name.match(/\.(jpe?g|png|gif|webp)$/i)?.[1] ?? 'jpg';
        const custom = sanitizeFilename(customBundleName);
        const outName = custom
          ? `${custom}-${r.id}`
          : `${r.id}_${sanitizeFilename(normalizeChinese(r.chinese))}`;
        const buf = await fetch(img.url).then(res => res.arrayBuffer());
        images.file(`${outName}.${ext}`, buf);
      }

      // 3. unmatched images — original filename
      for (const img of libraryImages) {
        if (!matchedNames.has(img.name)) {
          const buf = await fetch(img.url).then(res => res.arrayBuffer());
          images.file(img.name, buf);
        }
      }

      const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
      const zipName = libraryFolderName ? `已排版-${libraryFolderName}.zip` : `bundle_${ts}.zip`;
      triggerDownload(URL.createObjectURL(blob), zipName);
    } finally {
      setIsBundling(false);
    }
  };

  const toggleAuditOption = (id: string) => {
    const next = new Set(selectedAuditOptions);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedAuditOptions(next);
  };

  const openAuditEdit = (id: string) => {
    setEditingAuditId(id);
    setTempAuditInstruction(auditInstructions[id]);
    setShowAuditModal(true);
  };

  const saveAuditInstruction = () => {
    if (editingAuditId) {
      setAuditInstructions(prev => ({ ...prev, [editingAuditId]: tempAuditInstruction }));
    }
    setShowAuditModal(false);
  };

  const updateCorrectedEnglish = (id: string, value: string) => {
    setAuditResults(prev => prev.map(r =>
      r.id === id
        ? { ...r, correctedEnglish: value, qcEnglishHasChinese: hasChinese(value) }
        : r
    ));
  };

  return (
    <div className="h-screen bg-neutral-50 text-neutral-900 font-sans selection:bg-blue-100 flex flex-col overflow-hidden">
      {/* Top Navigation Bar */}
      <header className="h-11 bg-white border-b border-neutral-200 flex items-center px-4 z-40 shrink-0 gap-3">
        <div className="w-6 h-6 bg-blue-600 rounded-lg flex items-center justify-center shrink-0">
          <Type className="w-3.5 h-3.5 text-white" />
        </div>
        <span className="text-xs font-black text-neutral-700 uppercase tracking-widest">口播文案图片助手</span>
      </header>

      <div className="flex-1 flex overflow-hidden relative">
        {/* Left Sidebar */}
        {isSidebarCollapsed && (
            <button
              onClick={() => setIsSidebarCollapsed(false)}
              className="w-6 bg-white border-r border-y border-neutral-200 rounded-r-lg flex items-center justify-center shrink-0 z-20 hover:bg-blue-50 hover:text-blue-600 transition-colors shadow-sm self-stretch"
              title="展开侧边栏"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          )}
          <aside className={`${isSidebarCollapsed ? 'w-0 opacity-0 overflow-hidden' : 'w-80 opacity-100'} border-r border-neutral-200 bg-white flex flex-col shrink-0 z-20 transition-all duration-300 relative`}>
            {/* Collapse Button */}
            <button
              onClick={() => setIsSidebarCollapsed(true)}
              className="absolute -right-4 top-1/2 -translate-y-1/2 w-8 h-8 bg-white border border-neutral-200 rounded-full flex items-center justify-center shadow-md z-30 hover:text-blue-600 transition-all"
              title="折叠侧边栏"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            <div className="flex-1 overflow-y-auto custom-scrollbar">
                <div className="p-5 space-y-6">
                  {/* Engine & Key */}
                  <div className="space-y-3">
                    <h2 className="text-[10px] font-black text-neutral-400 uppercase tracking-widest flex items-center gap-2">
                      <Settings2 className="w-3 h-3" />
                      AI 引擎配置（文案质检）
                    </h2>
                    <div className="flex gap-1 bg-neutral-100 p-1 rounded-xl">
                      <button 
                        onClick={() => setMatchingEngine('gemini')}
                        className={`flex-1 py-1.5 rounded-lg text-[10px] font-bold transition-all ${
                          matchingEngine === 'gemini' ? 'bg-white text-blue-600 shadow-sm' : 'text-neutral-500 hover:text-neutral-700'
                        }`}
                      >
                        Gemini
                      </button>
                      <button 
                        onClick={() => setMatchingEngine('openrouter')}
                        className={`flex-1 py-1.5 rounded-lg text-[10px] font-bold transition-all ${
                          matchingEngine === 'openrouter' ? 'bg-white text-blue-600 shadow-sm' : 'text-neutral-500 hover:text-neutral-700'
                        }`}
                      >
                        OpenRouter
                      </button>
                      <button
                        onClick={() => setMatchingEngine('meta')}
                        className={`flex-1 py-1.5 rounded-lg text-[10px] font-bold transition-all ${
                          matchingEngine === 'meta' ? 'bg-white text-blue-600 shadow-sm' : 'text-neutral-500 hover:text-neutral-700'
                        }`}
                      >
                        Meta AI
                      </button>
                    </div>

                    {matchingEngine === 'gemini' && (
                      <div className="space-y-2">
                        <input
                          type="password"
                          value={geminiApiKey}
                          onChange={(e) => saveGeminiKey(e.target.value)}
                          placeholder="Gemini API Key（留空则仅排版，跳过 AI 质检）"
                          className="w-full px-3 py-2 rounded-xl border border-neutral-200 text-[10px] outline-none bg-neutral-50 focus:ring-2 focus:ring-blue-500"
                        />
                        <select
                          value={selectedGeminiModel}
                          onChange={(e) => setSelectedGeminiModel(e.target.value)}
                          disabled={!geminiApiKey}
                          title="质检使用的 Gemini 模型（填入 API Key 后自动加载可用列表，最新版在最上方）"
                          className={`w-full px-3 py-2 rounded-xl border text-[10px] outline-none bg-neutral-50 disabled:opacity-50 ${geminiModelsError ? 'border-red-300 text-red-600' : 'border-neutral-200'}`}
                        >
                          {geminiModels.length > 0 ? (
                            geminiModels.map(m => (
                              <option key={m.id} value={m.id}>{m.label}</option>
                            ))
                          ) : (
                            <option value={selectedGeminiModel}>
                              {geminiApiKey ? (geminiModelsError ? `${selectedGeminiModel}（列表加载失败）` : '正在加载模型…') : '填入 Key 后加载模型列表'}
                            </option>
                          )}
                        </select>
                        <p className="text-[8px] text-neutral-400 px-1">
                          AI 质检需要你自己的 Gemini API Key（可免费申请）；留空则仅做排版分段、不做 AI 质检。质检模型可在上方下拉选择，最新版排在最上方。
                        </p>
                      </div>
                    )}

                    {matchingEngine === 'openrouter' && (
                      <div className="space-y-2">
                        <input 
                          type="password"
                          value={openRouterApiKey}
                          onChange={(e) => saveOpenRouterKey(e.target.value)}
                          placeholder="OpenRouter API Key"
                          className="w-full px-3 py-2 rounded-xl border border-neutral-200 text-[10px] outline-none bg-neutral-50 focus:ring-2 focus:ring-blue-500"
                        />
                        <select 
                          value={selectedModelId}
                          onChange={(e) => setSelectedModelId(e.target.value)}
                          className={`w-full px-3 py-2 rounded-xl border ${openRouterModelsError ? 'border-red-300 text-red-600' : 'border-neutral-200 text-[10px]'} outline-none bg-neutral-50`}
                        >
                          {openRouterModels.length > 0 ? (
                            openRouterModels.map(m => (
                              <option key={m.id} value={m.id}>{m.name}</option>
                            ))
                          ) : openRouterModelsError ? (
                            <option value="google/gemini-flash-1.5-exp:free">Gemini Flash (Fallback)</option>
                          ) : (
                            <option>正在加载模型...</option>
                          )}
                        </select>
                        {openRouterModelsError && (
                          <div className="mt-1 text-[10px] text-red-500 font-medium">
                            {openRouterModelsError}
                          </div>
                        )}
                      </div>
                    )}

                    {matchingEngine === 'meta' && (
                      <div className="space-y-2">
                        <input
                          type="password"
                          value={metaApiKey}
                          onChange={(e) => saveMetaKey(e.target.value)}
                          placeholder="Meta AI API Key（留空则仅排版，跳过 AI 质检）"
                          className="w-full px-3 py-2 rounded-xl border border-neutral-200 text-[10px] outline-none bg-neutral-50 focus:ring-2 focus:ring-blue-500"
                        />
                        <p className="text-[8px] text-neutral-400 px-1">
                          使用 Meta Model API（dev.meta.ai 获取 Key），模型 {META_MODEL_ID}；质检直连 Meta API。
                        </p>
                      </div>
                    )}
                  </div>


                  <div className="pt-6 border-t border-neutral-100">
                    <button
                      onClick={() => {
                        if (window.confirm('确定要清除所有已输入的数据、图片和质检结果吗？此操作不可撤销。')) {
                          localStorage.clear();
                          window.location.reload();
                        }
                      }}
                      className="w-full py-2.5 rounded-xl border border-red-200 text-red-500 text-[10px] font-bold hover:bg-red-50 transition-all flex items-center justify-center gap-2"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      清除所有缓存数据
                    </button>
                  </div>
                </div>
            </div>
          </aside>

        {/* Main Content Area */}
        <main className="flex-1 flex flex-col bg-neutral-50 overflow-hidden">
            <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
              <div className="max-w-4xl mx-auto space-y-4">
                {/* Audit & Match Section */}
                <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm overflow-hidden">
                  <div className="px-5 py-3 border-b border-neutral-100 bg-neutral-50/50 flex items-center gap-3">
                    <div className="w-7 h-7 bg-blue-600 rounded-lg flex items-center justify-center shadow shadow-blue-100 shrink-0">
                      <Type className="text-white w-3.5 h-3.5" />
                    </div>
                    <span className="text-sm font-bold text-neutral-900">文案质检与匹配</span>
                  </div>

                  <div className="p-5 space-y-4">
                    {/* Input Area */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between px-1">
                        <span className="text-[10px] font-black text-neutral-400 uppercase tracking-widest">文案库 (支持 1. 中 2. 英 格式)</span>
                        <span className={`text-[10px] font-bold ${getCharCountColor(copywriting.length)}`}>{copywriting.length} 字符</span>
                      </div>
                      <textarea
                        value={copywriting}
                        onChange={(e) => setCopywriting(e.target.value)}
                        onPaste={handlePaste}
                        placeholder="1 中文内容 English content...&#10;2 中文内容 English content..."
                        className={`w-full h-36 px-4 py-3 rounded-xl border focus:ring-2 outline-none text-sm leading-relaxed resize-none font-mono transition-all duration-500 ${
                          isPasted
                            ? 'bg-green-50 border-green-400 ring-green-500/20 text-green-800'
                            : 'bg-neutral-50/50 border-neutral-200 focus:ring-blue-500/10 focus:border-blue-500'
                        }`}
                      />
                    </div>

                    {/* Options Row */}
                    <div className="flex flex-wrap gap-2">
                      {[
                        { id: 'spelling', name: '拼写校对' },
                        { id: 'case', name: '大小写规范' },
                        { id: 'punctuation', name: '标点格式化' },
                        { id: 'sequence', name: '序列清洗' }
                      ].map(opt => (
                        <div key={opt.id} className="flex items-center gap-1">
                          <button
                            onClick={() => toggleAuditOption(opt.id)}
                            className={`px-3 py-1.5 rounded-lg border text-xs font-bold transition-all ${
                              selectedAuditOptions.has(opt.id)
                                ? 'bg-blue-600 border-blue-600 text-white'
                                : 'bg-white border-neutral-200 text-neutral-500 hover:border-neutral-300'
                            }`}
                          >
                            {opt.name}
                          </button>
                          <button
                            onClick={() => openAuditEdit(opt.id)}
                            className="p-1 text-neutral-300 hover:text-blue-500 transition-all rounded"
                            title="编辑规则"
                          >
                            <Settings2 className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                    </div>

                    {/* Custom Prompt */}
                    <div className="p-3 bg-neutral-50 rounded-xl border border-neutral-100 space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <Wand2 className="w-3.5 h-3.5 text-blue-600" />
                          <span className="text-xs font-bold text-neutral-700">自定义质检指令</span>
                        </div>
                        <button
                          onClick={() => toggleAuditOption('custom')}
                          className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold transition-all ${
                            selectedAuditOptions.has('custom') ? 'bg-blue-600 text-white' : 'bg-neutral-200 text-neutral-500'
                          }`}
                        >
                          {selectedAuditOptions.has('custom') ? '已启用' : '未启用'}
                        </button>
                      </div>
                      <textarea
                        value={auditInstructions['custom']}
                        onChange={(e) => setAuditInstructions(prev => ({ ...prev, custom: e.target.value }))}
                        placeholder="输入额外的质检要求，例如：不要纠正介词搭配，不要风格润色..."
                        className="w-full h-14 px-3 py-2 rounded-lg border border-neutral-200 focus:ring-2 focus:ring-blue-500 outline-none text-xs leading-relaxed resize-none bg-white"
                      />
                    </div>

                    <div className="flex gap-3">
                      <button
                        onClick={() => handleAuditCopy()}
                        disabled={isAuditing || !copywriting}
                        className={`flex-[3] py-2.5 rounded-xl font-bold flex items-center justify-center gap-2 transition-all shadow active:scale-[0.98] text-sm ${
                          isAuditing || !copywriting
                            ? 'bg-neutral-100 text-neutral-400 cursor-not-allowed shadow-none'
                            : 'bg-blue-600 text-white hover:bg-blue-700 shadow-blue-100'
                        }`}
                      >
                        {isAuditing ? (
                          <div className="flex flex-col items-center gap-0.5">
                            <div className="flex items-center gap-2">
                              <Loader2 className="w-4 h-4 animate-spin" />
                              <span>{auditSkippedAI ? '正在排版' : '正在质检'} {auditProgress ? `(${auditProgress})` : ''}</span>
                            </div>
                            {retryStatus && (
                              <span className="text-[10px] bg-red-500/20 px-2 py-0.5 rounded-full animate-pulse">
                                重试中: 第 {retryStatus.attempt}/{retryStatus.total} 次 | {retryStatus.nextRetryIn}秒后
                              </span>
                            )}
                            {!auditSkippedAI && activeModelId !== "gemini-3-flash-preview" && (
                              <span className="text-[9px] opacity-70">已自动降级至备选模型加速处理</span>
                            )}
                          </div>
                        ) : (
                          <>
                            <ShieldCheck className="w-4 h-4" />
                            {hasAuditKey ? '开始质检' : '仅排版（未填 Key，跳过质检）'}
                          </>
                        )}
                      </button>

                      <button
                        onClick={() => {
                          if (window.confirm('确定要清空当前文案和质检结果，开始新的任务吗？')) {
                            setCopywriting('');
                            setAuditResults([]);
                            setCopiedAuditTextKeys(new Set());
                            setAuditError(null);
                            setAuditProgress(null);
                          }
                        }}
                        className="flex-1 py-2.5 rounded-xl bg-white border border-neutral-200 text-neutral-400 font-bold flex items-center justify-center gap-1.5 hover:bg-neutral-50 transition-all active:scale-[0.98] text-sm"
                        title="开启新任务"
                      >
                        <Plus className="w-4 h-4" />
                        <span className="hidden md:inline">新任务</span>
                      </button>
                    </div>
                  </div>
                </div>

                {/* Audit Results Section */}
                {auditError && (
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="overflow-hidden bg-white border border-red-100 rounded-[2.5rem] shadow-xl shadow-red-50/50"
                  >
                    <div className="p-6 md:p-8 flex flex-col md:flex-row items-start md:items-center gap-6">
                      <div className="w-14 h-14 bg-red-50 rounded-2xl flex items-center justify-center shrink-0">
                        <AlertCircle className="w-7 h-7 text-red-500" />
                      </div>
                      <div className="flex-1 space-y-1">
                        <h3 className="text-lg font-bold text-neutral-900 leading-tight">文案质检未能完成</h3>
                        <p className="text-sm text-neutral-500 font-medium">{auditError}</p>
                      </div>
                      <div className="flex flex-col sm:flex-row gap-3 w-full md:w-auto">
                        <button 
                          onClick={() => setShowTechnicalDetails(!showTechnicalDetails)}
                          className="px-5 py-3 rounded-xl text-xs font-bold text-neutral-400 hover:text-neutral-600 hover:bg-neutral-50 transition-all border border-neutral-100"
                        >
                          {showTechnicalDetails ? '隐藏技术细节' : '查看技术细节'}
                        </button>
                        <button 
                          onClick={() => handleAuditCopy()}
                          className="px-8 py-3 bg-red-600 text-white rounded-xl text-xs font-bold hover:bg-red-700 transition-all shadow-lg shadow-red-100 ring-4 ring-red-50"
                        >
                          立即重新处理
                        </button>
                      </div>
                    </div>

                    <AnimatePresence>
                      {showTechnicalDetails && auditTechnicalError && (
                        <motion.div 
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          className="bg-neutral-50 border-t border-neutral-100"
                        >
                          <div className="p-6 md:p-8 space-y-4">
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] font-black text-neutral-400 uppercase tracking-widest">错误报告 (Raw Payload)</span>
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] font-bold text-neutral-300">TRACE_ID:</span>
                                <code className="text-[10px] font-black bg-neutral-200 px-2 py-0.5 rounded text-neutral-600">{auditTechnicalError.traceId}</code>
                              </div>
                            </div>
                            <div className="bg-neutral-900 rounded-2xl p-4 overflow-x-auto shadow-inner">
                              <pre className="text-[10px] font-mono text-green-400/80 leading-relaxed">
                                {auditTechnicalError.message}
                              </pre>
                            </div>
                            <p className="text-[9px] text-neutral-400 italic">
                              * 此错误已通过"归一化策略"自动归类为 [CATEGORY:{auditTechnicalError.category.toUpperCase()}]，如有波动请联系技术支持并提供 TRACE_ID。
                            </p>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                )}

                {auditResults.length > 0 && (
                  <motion.div 
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="space-y-4"
                  >
                    <div className="flex items-center justify-between px-1">
                      <div className="flex items-center gap-2">
                        {/* Select-all checkbox: selects all + copies to clipboard */}
                        <button
                          onClick={() => {
                            const allIds = new Set(auditResults.map(r => r.id));
                            const allSelected = selectedAuditIds.size === auditResults.length;
                            if (allSelected) {
                              setSelectedAuditIds(new Set());
                            } else {
                              setSelectedAuditIds(allIds);
                              const lines = auditResults.map(r => normalizeEnglish(r.correctedEnglish)).join('\n');
                              copyToClipboard(lines);
                            }
                          }}
                          title={selectedAuditIds.size === auditResults.length ? '取消全选' : '全选并复制全部英文'}
                          className={`w-6 h-6 rounded-md border-2 flex items-center justify-center transition-all shrink-0 ${
                            selectedAuditIds.size === auditResults.length
                              ? 'bg-blue-600 border-blue-600 text-white'
                              : selectedAuditIds.size > 0
                              ? 'bg-blue-100 border-blue-400 text-blue-600'
                              : 'border-neutral-300 hover:border-blue-400'
                          }`}
                        >
                          {selectedAuditIds.size === auditResults.length
                            ? <CheckSquare className="w-3.5 h-3.5" />
                            : selectedAuditIds.size > 0
                            ? <CheckSquare className="w-3.5 h-3.5" />
                            : <Square className="w-3.5 h-3.5 text-neutral-400" />}
                        </button>
                        <div className="flex flex-col">
                          <h3 className="text-sm font-bold text-neutral-800 flex items-center gap-2">
                            <CheckCircle2 className="w-5 h-5 text-green-500" />
                            质检审查列表 ({auditResults.length})
                            {auditSkippedAI && (
                              <span className="text-[9px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                                仅排版 — 未填 API Key，未做 AI 质检
                              </span>
                            )}
                          </h3>
                          {lastSaved && (
                            <span className="text-[9px] text-neutral-400 mt-0.5">上次自动保存: {lastSaved}</span>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-4 items-center">
                        {selectedAuditIds.size > 0 && (
                          <button
                            onClick={() => {
                              const lines = auditResults
                                .filter(r => selectedAuditIds.has(r.id))
                                .map(r => normalizeEnglish(r.correctedEnglish))
                                .join('\n');
                              copyToClipboard(lines);
                            }}
                            className="text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-all shadow-sm shadow-blue-200"
                            title="复制选中条目的英文文案，每条一行，可直接粘贴到 Google Sheet"
                          >
                            <Copy className="w-3.5 h-3.5" />
                            复制英文到 Sheet ({selectedAuditIds.size})
                          </button>
                        )}
                        <button
                          onClick={randomMatch}
                          disabled={libraryImages.length === 0}
                          className="text-xs font-bold text-purple-600 hover:underline flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed disabled:no-underline"
                          title="把未匹配的文案随机配上图片，之后可手动调整"
                        >
                          <Shuffle className="w-3.5 h-3.5" />
                          随机匹配
                        </button>
                        <input
                          type="text"
                          value={customBundleName}
                          onChange={(e) => setCustomBundleName(e.target.value)}
                          placeholder="自定义名称（留空用原命名）"
                          title="填写后，ZIP 里匹配图命名为「自定义名称-序号」；留空则保持原「序号_中文」命名"
                          className="text-xs font-medium text-neutral-700 outline-none border border-neutral-200 rounded-lg px-2.5 py-1.5 w-52 focus:border-blue-400"
                        />
                        <button
                          onClick={() => bundleDownload()}
                          disabled={isBundling}
                          className="text-xs font-bold text-green-600 hover:underline flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-wait"
                        >
                          <Download className="w-3.5 h-3.5" />
                          {isBundling ? '打包中…' : '打包下载 (TSV)'}
                        </button>
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-1 gap-2.5">
                      {auditResults.map((res, i) => {
                        const isAuditSelected = selectedAuditIds.has(res.id);
                        const matchedName = matchMap[res.id];
                        const matchedImg = matchedName ? fileByName[matchedName] : undefined;
                        const handleCardDrop = (e: React.DragEvent) => {
                          const name = e.dataTransfer.getData(INTERNAL_IMAGE_MIME);
                          if (!name) return;
                          e.preventDefault();
                          e.stopPropagation();
                          setMatchMap(prev => ({ ...prev, [res.id]: name }));
                          setCardDragOver(null);
                        };
                        return (
                        <div
                          key={res.id}
                          onClick={() => {
                            setSelectedAuditIds(prev => {
                              const next = new Set(prev);
                              next.has(res.id) ? next.delete(res.id) : next.add(res.id);
                              return next;
                            });
                          }}
                          onDragOver={(e) => {
                            if (e.dataTransfer.types.includes(INTERNAL_IMAGE_MIME)) {
                              e.preventDefault();
                              e.stopPropagation();
                              setCardDragOver(res.id);
                            }
                          }}
                          onDragLeave={(e) => {
                            if (!e.currentTarget.contains(e.relatedTarget as Node))
                              setCardDragOver(null);
                          }}
                          onDrop={handleCardDrop}
                          className={`apple-card overflow-hidden flex flex-col transition-all cursor-pointer select-none
                            ${isAuditSelected
                              ? 'ring-2 ring-blue-500 shadow-md shadow-blue-100'
                              : cardDragOver === res.id
                              ? 'ring-2 ring-purple-400 shadow-md shadow-purple-100 scale-[1.01]'
                              : 'hover:shadow-sm'}`}
                        >
                          <div className="px-4 py-2 bg-neutral-50/50 border-b border-neutral-100 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              {isAuditSelected
                                ? <CheckSquare className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                                : <Square className="w-3.5 h-3.5 text-neutral-300 shrink-0" />}
                              <span className="px-1.5 py-0.5 bg-emerald-100 text-[9px] font-black text-emerald-700 rounded uppercase tracking-widest">{res.id}</span>
                              <span className="text-sm font-semibold text-neutral-800">{res.chinese}</span>
                              {res.qcEnglishHasChinese && (
                                <span className="px-1.5 py-0.5 bg-red-100 text-[9px] font-black text-red-700 rounded uppercase tracking-widest shrink-0">⚠ 英文含中文</span>
                              )}
                            </div>
                            <div className="flex items-center gap-3 shrink-0">
                              <div className="text-[10px] font-medium text-neutral-400">
                                <span className={`font-bold ${getCharCountColor(res.correctedEnglish.length)}`}>{res.correctedEnglish.length}</span>
                              </div>
                              <AuditImageSlot
                                copyId={res.id}
                                chineseText={res.chinese}
                                matchedImg={matchedImg}
                                matchedName={matchedName}
                                isSelected={isAuditSelected}
                                onDropImage={(name) => setMatchMap(prev => ({ ...prev, [res.id]: name }))}
                                onClear={() => setMatchMap(prev => {
                                  const { [res.id]: _, ...rest } = prev;
                                  return rest;
                                })}
                                onDragStartFiles={() => collectDragFiles(res.id)}
                              />
                            </div>
                          </div>
                          <div className="p-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                            {/* Original with Markup */}
                            <div className="space-y-1 group">
                              <div className="flex items-center justify-between">
                                <span className="text-[9px] font-black text-neutral-300 uppercase tracking-widest">对比审查</span>
                                <CopyButton text={res.originalEnglish} />
                              </div>
                              <CopyableText
                                text={res.originalEnglish}
                                className="rounded-xl"
                                hasBeenCopied={copiedAuditTextKeys.has(`${res.id}:original`)}
                                onCopy={() => setCopiedAuditTextKeys(prev => new Set(prev).add(`${res.id}:original`))}
                              >
                                <div className="px-3 py-2 bg-neutral-50 rounded-xl border border-dashed border-neutral-200 text-xs leading-relaxed text-neutral-500 min-h-[56px]">
                                  {buildMarkup(res.originalEnglish, res.correctedEnglish).split(/(\*\*.*?\*\*|~~.*?~~)/).map((part, idx) => {
                                    if (part.startsWith('**') && part.endsWith('**')) {
                                      return <span key={idx} className="bg-green-100 text-green-700 px-0.5 rounded font-bold">{part.slice(2, -2)}</span>;
                                    }
                                    if (part.startsWith('~~') && part.endsWith('~~')) {
                                      return <span key={idx} className="bg-red-100 text-red-700 px-0.5 rounded line-through">{part.slice(2, -2)}</span>;
                                    }
                                    return part;
                                  })}
                                </div>
                              </CopyableText>
                            </div>

                            {/* Corrected */}
                            <div className="space-y-1 group">
                              <div className="flex items-center justify-between">
                                <span className="text-[9px] font-black text-blue-400 uppercase tracking-widest">修正结果 · 可编辑</span>
                                <CopyButton text={res.correctedEnglish} />
                              </div>
                              <textarea
                                value={res.correctedEnglish}
                                onChange={(e) => updateCorrectedEnglish(res.id, e.target.value)}
                                onClick={(e) => e.stopPropagation()}
                                spellCheck={false}
                                className="w-full px-3 py-2 bg-blue-50/30 rounded-xl border border-blue-100 text-xs font-medium leading-relaxed text-neutral-800 min-h-[56px] max-h-[60vh] overflow-y-auto resize-y outline-none cursor-text focus:border-blue-400 focus:bg-white transition-colors [field-sizing:content]"
                              />
                            </div>
                          </div>
                        </div>
                        );
                      })}
                    </div>
                  </motion.div>
                )}
              </div>
            </div>
        </main>
        <ImageLibrary
          matchMap={matchMap}
          onImagesLoaded={setLibraryImages}
          onCopywritingLoaded={setCopywriting}
          onFolderName={setLibraryFolderName}
          onVoiceId={setVoiceId}
          onVoiceEngine={setVoiceEngine}
          onVoiceSpeed={setVoiceSpeed}
        />
      </div>

      {/* Audit Option Modal */}
      <AnimatePresence>
        {showAuditModal && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowAuditModal(false)}
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative w-full max-w-sm bg-white rounded-3xl shadow-2xl p-6"
            >
              <h3 className="text-lg font-bold text-neutral-900 mb-4 flex items-center gap-2">
                <Settings2 className="w-5 h-5 text-blue-600" />
                微调质检指令
              </h3>
              <textarea 
                value={tempAuditInstruction}
                onChange={(e) => setTempAuditInstruction(e.target.value)}
                className="w-full h-32 px-4 py-3 rounded-2xl border border-neutral-200 focus:ring-2 focus:ring-blue-500 outline-none text-xs text-neutral-600 leading-relaxed resize-none bg-neutral-50"
                placeholder="输入该选项对应的详细指令（简体中文）..."
              />
              <div className="flex gap-2 mt-6">
                <button 
                  onClick={() => setShowAuditModal(false)}
                  className="flex-1 py-3 text-xs font-bold text-neutral-400 hover:text-neutral-600"
                >
                  取消
                </button>
                <button 
                  onClick={saveAuditInstruction}
                  className="flex-[2] py-3 bg-blue-600 text-white rounded-xl text-xs font-bold hover:bg-blue-700 shadow-lg shadow-blue-100"
                >
                  保存配置
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {unmatchedWarning && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setUnmatchedWarning(null)}
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative w-full max-w-sm bg-white rounded-3xl shadow-2xl p-6"
            >
              <h3 className="text-lg font-bold text-neutral-900 mb-2 flex items-center gap-2">
                <AlertCircle className="w-5 h-5 text-amber-500" />
                有文案尚未配图
              </h3>
              <p className="text-xs text-neutral-500 leading-relaxed mb-3">
                以下 {unmatchedWarning.ids.length} 条文案还没有匹配图片，继续下载将不包含它们的配图。
              </p>
              <div className="flex flex-wrap gap-1.5 mb-5 max-h-32 overflow-y-auto">
                {unmatchedWarning.ids.map(id => (
                  <span key={id} className="px-2 py-0.5 bg-amber-100 text-[11px] font-black text-amber-700 rounded-full">
                    #{id}#
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setUnmatchedWarning(null)}
                  className="flex-1 py-3 text-xs font-bold text-neutral-400 hover:text-neutral-600"
                >
                  取消
                </button>
                <button
                  onClick={() => {
                    setUnmatchedWarning(null);
                    performBundleDownload();
                  }}
                  className="flex-[2] py-3 bg-amber-500 text-white rounded-xl text-xs font-bold hover:bg-amber-600 shadow-lg shadow-amber-100"
                >
                  仍然下载
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #e5e7eb;
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #d1d5db;
        }
      `}</style>
    </div>
  );
}

// ── Audit row image slot ─────────────────────────────────────────────────────
interface AuditImageSlotProps {
  copyId: string;
  chineseText: string;
  matchedImg?: LoadedImage;
  matchedName?: string;
  isSelected: boolean;
  onDropImage: (filename: string) => void;
  onClear: () => void;
  /** Returns the list of files to attach to dataTransfer when this slot is dragged. */
  onDragStartFiles: () => File[];
}

function AuditImageSlot({
  copyId, chineseText, matchedImg, matchedName, onDropImage, onClear, onDragStartFiles,
}: AuditImageSlotProps) {
  const sanitize = (text: string, max = 50) =>
    text.slice(0, max).replace(/[\\/:*?"<>|]/g, '').replace(/[\x00-\x1f\x7f]/g, '')
      .replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '');
  const [over, setOver] = useState(false);

  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setOver(false);
    const name = e.dataTransfer.getData(INTERNAL_IMAGE_MIME);
    if (name) onDropImage(name);
  };

  const handleDragStart = (e: React.DragEvent) => {
    e.stopPropagation();
    const files = onDragStartFiles();
    if (files.length === 0) {
      e.preventDefault();
      return;
    }
    for (const f of files) e.dataTransfer.items.add(f);
    e.dataTransfer.effectAllowed = 'copy';
  };

  return (
    <div
      onClick={stop}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(INTERNAL_IMAGE_MIME)) {
          e.preventDefault();
          e.stopPropagation();
          setOver(true);
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={handleDrop}
      draggable={!!matchedImg}
      onDragStart={handleDragStart}
      title={matchedImg
        ? `${matchedName} — 拖到 Heygen 上传`
        : '将右侧图片拖到这里完成匹配'}
      className={`relative w-[240px] h-[240px] rounded-lg shrink-0 transition-all
        ${matchedImg
          ? 'cursor-grab active:cursor-grabbing border border-neutral-200 hover:border-blue-400 hover:shadow-md'
          : 'border-2 border-dashed border-neutral-300 bg-neutral-50 flex items-center justify-center'}
        ${over ? 'ring-2 ring-blue-400 border-blue-400 scale-105' : ''}`}
    >
      {matchedImg ? (
        <>
          <img
            src={matchedImg.url}
            alt={matchedImg.name}
            draggable={false}
            className="w-full h-full object-cover rounded-lg pointer-events-none"
          />
          <button
            onClick={(e) => { e.stopPropagation(); onClear(); }}
            className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-red-500 hover:bg-red-600 text-white text-base font-bold flex items-center justify-center shadow leading-none"
            title="清除匹配"
          >
            ×
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              const ext = matchedImg!.name.match(/\.(jpe?g|png|gif|webp)$/i)?.[1] ?? 'jpg';
              const label = sanitize(chineseText.replace(/\s*\n\s*/g, ' ').trim());
              const link = document.createElement('a');
              link.href = matchedImg!.url;
              link.download = `${copyId}_${label}.${ext}`;
              document.body.appendChild(link);
              link.click();
              document.body.removeChild(link);
            }}
            className="absolute -bottom-1.5 -right-1.5 w-4 h-4 rounded-full bg-blue-500 text-white flex items-center justify-center shadow"
            title="下载此图片"
          >
            <Download className="w-2.5 h-2.5" />
          </button>
        </>
      ) : (
        <span className="text-[9px] text-neutral-400 font-bold">拖图</span>
      )}
    </div>
  );
}
