import type { ImageGenerationQuality, ImageModel } from "@/lib/api";
import type { ImageRatioOption } from "@/shared/image-generation";
import type { ImageMode } from "@/store/image-conversations";

import type { PromptExample } from "./composer";

type ModeOption = { label: string; value: ImageMode; description: string };
type ImageModelOption = { label: string; value: ImageModel };
type GenerationOption<T extends string> = { label: string; value: T };

type InspirationExample = PromptExample & {
  id: string;
  title: string;
  hint: string;
  tone: string;
};

export const imageModelOptions: ImageModelOption[] = [
  { label: "gpt-image-2", value: "gpt-image-2" },
  { label: "gpt-image-1", value: "gpt-image-1" },
];

export const modeOptions: ModeOption[] = [
  { label: "生成", value: "generate", description: "提示词生成新图，也可上传参考图辅助生成" },
  { label: "编辑", value: "edit", description: "上传图像后局部或整体改图" },
  { label: "增强", value: "upscale", description: "基于源图做高清增强，提升清晰度与细节" },
];

export const imageSizeOptions: GenerationOption<ImageRatioOption>[] = [
  { label: "Auto", value: "auto" },
  { label: "1:1 方图", value: "1:1" },
  { label: "3:2 横图", value: "3:2" },
  { label: "2:3 竖图", value: "2:3" },
  { label: "16:9 横屏", value: "16:9" },
  { label: "9:16 竖屏", value: "9:16" },
];

export const imageQualityOptions: GenerationOption<ImageGenerationQuality>[] = [
  { label: "Auto", value: "auto" },
  { label: "1K", value: "low" },
  { label: "2K", value: "medium" },
  { label: "4K", value: "high" },
];

export const upscaleQualityOptions: GenerationOption<ImageGenerationQuality>[] = [
  { label: "Auto", value: "auto" },
  { label: "Low", value: "low" },
  { label: "Medium", value: "medium" },
  { label: "High", value: "high" },
];

export const inspirationExamples: InspirationExample[] = [
  {
    id: "stellar-poster",
    title: "卡芙卡轮廓宇宙海报",
    prompt:
      "请根据【主题：崩坏星穹铁道，角色卡芙卡】自动生成一张高审美的轮廓宇宙收藏版叙事海报风格作品。不要将画面局限于固定器物或常见容器，不要优先默认瓶子、沙漏、玻璃罩、怀表之类的常规载体，而是由 AI 根据主题自行判断并选择一个最契合、最有象征意义、轮廓最强、最适合承载完整叙事世界的主轮廓载体。这个主轮廓可以是器物、建筑、门、塔、拱门、穹顶、楼梯井、长廊、雕像、侧脸、眼睛、手掌、头骨、羽翼、面具、镜面、王座、圆环、裂缝、光幕、阴影、几何结构、空间切面、舞台框景、抽象符号或其他更有创意与主题代表性的视觉轮廓，要求合理布局。优先选择最能放大主题气质的轮廓。画面的核心不是简单把世界装进某个物体里，而是让完整的主题世界自然生长在这个主轮廓之中。主轮廓必须清晰、优雅、有辨识度。整体构图需要具有强烈的收藏版海报气质与高级设计感。风格融合收藏版电影海报构图、高级叙事型视觉设计、梦幻水彩质感与纸张印刷品气质。色彩由 AI 根据主题自动判断。",
    hint: "适合高审美叙事海报、角色宇宙主题视觉、收藏版概念海报。",
    model: "gpt-image-2",
    count: 1,
    tone: "from-[#17131f] via-[#4c2d45] to-[#b79b8b]",
  },
  {
    id: "qinghua-museum-infographic",
    title: "青花瓷博物馆图鉴",
    prompt:
      "请根据青花瓷自动生成一张博物馆图鉴式中文拆解信息图。要求整张图兼具真实写实主视觉、结构拆解、中文标注、材质说明、纹样寓意、色彩含义和核心特征总结。整体风格应为国家博物馆展板、历史服饰图鉴、文博专题信息图。背景采用米白、绢纸白、浅茶色等纸张质感，整体高级、克制、专业、可收藏。所有文字必须为简体中文。",
    hint: "适合文博专题、器物拆解、中文信息图和展板式视觉。",
    model: "gpt-image-2",
    count: 1,
    tone: "from-[#0d2f5f] via-[#3a6ea5] to-[#e7dcc4]",
  },
  {
    id: "editorial-fashion",
    title: "周芷若联动宣传图",
    prompt:
      "《倚天屠龙记》周芷若的维秘联动活动宣传图，人物占画面 80% 以上，周芷若在古风古城城墙上，优雅侧身回眸姿态，高品质真人级 3D 古风游戏截图风格，电影级光影，背景为夜晚古城墙，青砖城垛、灯笼照明、月光洒落，高细节，8K 品质。",
    hint: "适合古风角色联动、游戏活动主视觉、电影感人物宣传图。",
    model: "gpt-image-2",
    count: 1,
    tone: "from-zinc-900 via-rose-800 to-amber-500",
  },
  {
    id: "forza-horizon-shenzhen",
    title: "地平线 8 深圳实机图",
    prompt:
      "创作一张图片为《极限竞速 地平线 8》的游戏实机截图，游戏背景设为中国，背景城市为深圳，时间设定为 2028 年。画面需要体现真实次世代开放世界赛车游戏的实机演出效果，包含具有深圳辨识度的城市天际线。构图中在合适位置放置《极限竞速 地平线 8》的 logo 及宣传文案。要求 8K 超高清，电影级光影。",
    hint: "适合游戏主视觉、次世代赛车截图、城市宣传感概念图。",
    model: "gpt-image-2",
    count: 1,
    tone: "from-slate-950 via-cyan-900 to-orange-500",
  },
];
