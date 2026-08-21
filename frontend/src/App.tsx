import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Group, Image as KonvaImage, Layer, Line, Rect, Stage, Text } from "react-konva";
import "./App.css";
import { LADDER_PRESET_GROUPS } from "./data/ladderPresets";
import {
  buildEqualLanes,
  detectLadderBands,
  grayscaleFromImageData,
  parseLadderSizes,
  preprocessGray,
  type LaneBound,
} from "./lib/gelProcessing";

type AnalysisState = {
  width: number;
  height: number;
  laneBounds: LaneBound[];
  ladderYAuto: number[];
  ladderSizesBp: number[];
  mismatch: boolean;
};

function GelImage({
  src,
  x,
  y,
  w,
  h,
}: {
  src: string;
  x: number;
  y: number;
  w: number;
  h: number;
}) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);

  useEffect(() => {
    if (!src) {
      setImg(null);
      return;
    }
    const image = new window.Image();
    image.crossOrigin = "anonymous";
    image.src = src;
    image.onload = () => setImg(image);
    image.onerror = () => setImg(null);
  }, [src]);

  if (!img) return null;
  return <KonvaImage image={img} x={x} y={y} width={w} height={h} />;
}

type ToastState = { type: "info" | "success"; message: string } | null;

export default function App() {
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    const saved = localStorage.getItem("gel-theme");
    return saved === "dark" ? "dark" : "light";
  });

  const [file, setFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState("");
  const [imgMeta, setImgMeta] = useState({ width: 1000, height: 500 });

  const [nLanesInput, setNLanesInput] = useState("8");
  const [ladderLaneInput, setLadderLaneInput] = useState("1");
  const [ladderPresetKey, setLadderPresetKey] = useState("custom");
  const [ladderSizes, setLadderSizes] = useState("2000,1000,750,500,250,100");
  const [laneLabels, setLaneLabels] = useState("Ladder\nS1\nS2\nS3\nS4\nS5\nS6\nS7");

  const [laneTextScale, setLaneTextScale] = useState(1.0);
  const [ladderTextScale, setLadderTextScale] = useState(1.0);

  const [invert, setInvert] = useState(false);
  const [showLaneBoxes, setShowLaneBoxes] = useState(true);
  const [laneLabelAngle, setLaneLabelAngle] = useState(32);
  const [transparentBg, setTransparentBg] = useState(false);

  const [laneRegion, setLaneRegion] = useState<[number, number]>([0, 999]); // native coords
  const [ladderY, setLadderY] = useState<number[]>([]); // native coords

  const [analysis, setAnalysis] = useState<AnalysisState | null>(null);
  const setIsAnalyzing = (_v: boolean) => {}; // intentionally no analyze spinner
  const [isAnnotating, setIsAnnotating] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [toast, setToast] = useState<ToastState>(null);

  const [sourceImage, setSourceImage] = useState<HTMLImageElement | null>(null);
  const [sourceImageData, setSourceImageData] = useState<ImageData | null>(null);

  const analyzeRunId = useRef(0);

  const showToast = (message: string, type: "info" | "success" = "info") => {
    setToast({ type, message });
    window.setTimeout(() => setToast(null), 2200);
  };

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("gel-theme", theme);
  }, [theme]);

  const nLanesValid = /^\d+$/.test(nLanesInput) && Number(nLanesInput) >= 1;
  const ladderLaneValid = /^\d+$/.test(ladderLaneInput) && Number(ladderLaneInput) >= 1;
  const nLanes = nLanesValid ? Number(nLanesInput) : 1;
  const ladderLane = ladderLaneValid ? Number(ladderLaneInput) : 1;

  const parsedLadderSizes = useMemo(() => parseLadderSizes(ladderSizes), [ladderSizes]);

  const presetMap = useMemo(() => {
    const m = new Map<string, { key: string; label: string; sizes: number[] }>();
    LADDER_PRESET_GROUPS.forEach((g) => g.presets.forEach((p) => m.set(p.key, p)));
    return m;
  }, []);

  const applyPreset = (key: string) => {
    setLadderPresetKey(key);
    const preset = presetMap.get(key);
    if (!preset) return;
    if (key !== "custom") {
      setLadderSizes(preset.sizes.join(","));
      showToast(`Preset loaded: ${preset.label}`, "info");
    }
  };

  useEffect(() => {
    if (ladderPresetKey === "custom") return;
    const p = presetMap.get(ladderPresetKey);
    if (!p) return;
    const presetString = p.sizes.join(",");
    const normalizedCurrent = ladderSizes.replace(/\s+/g, "");
    if (normalizedCurrent !== presetString) setLadderPresetKey("custom");
  }, [ladderSizes, ladderPresetKey, presetMap]);

  const nativeWidth = analysis?.width ?? imgMeta.width;
  const nativeHeight = analysis?.height ?? imgMeta.height;

  const MAX_PREVIEW_HEIGHT = 720;
  const MAX_PREVIEW_WIDTH = 1200;
  const canvasScale = Math.min(1, MAX_PREVIEW_HEIGHT / nativeHeight, MAX_PREVIEW_WIDTH / nativeWidth);

  const drawWidth = Math.max(1, Math.round(nativeWidth * canvasScale));
  const drawHeight = Math.max(1, Math.round(nativeHeight * canvasScale));

  const uiScale = Math.max(0.9, Math.min(2.4, Math.pow(drawWidth / 900, 0.95)));

  const laneLabelFont = Math.round(16 * uiScale * laneTextScale);
  const ladderLabelFont = Math.round(22 * uiScale * ladderTextScale);
  const smallLabelFont = Math.round(13 * uiScale);

  const handleW = Math.round(14 * uiScale);
  const handleH = Math.round(18 * uiScale);

  const laneBoxStroke = Math.max(1, Math.round(2 * uiScale));
  const axisStroke = Math.max(1, Math.round(1 * uiScale));

  const labelList = useMemo(() => {
    const arr = laneLabels
      .split("\n")
      .map((x) => x.trim())
      .filter(Boolean);
    while (arr.length < nLanes) arr.push(`S ${arr.length + 1}`);
    return arr.slice(0, nLanes);
  }, [laneLabels, nLanes]);

  const maxLabelChars = Math.max(1, ...labelList.map((s) => s.length));
  const laneAngleRad = (Math.abs(laneLabelAngle) * Math.PI) / 180;
  const estMaxLabelWidth = Math.max(laneLabelFont, maxLabelChars * laneLabelFont * 0.58);
  const laneLabelBBoxHeight =
    Math.abs(estMaxLabelWidth * Math.sin(laneAngleRad)) + Math.abs(laneLabelFont * Math.cos(laneAngleRad));

  const leftPad = Math.round(130 * uiScale);
  const topPad = Math.max(
    Math.round(68 * uiScale),
    Math.ceil((laneLabelBBoxHeight / 2 + 10 * uiScale) / 0.62)
  );
  const bottomHandlePad = Math.round(52 * uiScale);

  const displayImageUrl = filePreview;

  const normalizedRegion = useMemo<[number, number]>(() => {
    const a = Math.min(laneRegion[0], laneRegion[1]);
    const b = Math.max(laneRegion[0], laneRegion[1]);
    return [a, b];
  }, [laneRegion]);

  const provisionalLaneBounds = useMemo(() => {
    const [x0, x1] = normalizedRegion;
    return buildEqualLanes(x0, x1, nLanes);
  }, [normalizedRegion, nLanes]);

  const laneBoundsToDraw = analysis?.laneBounds ?? provisionalLaneBounds;

  const sx = (x: number) => Math.round(x * canvasScale);
  const sy = (y: number) => Math.round(y * canvasScale);
  const nx = (xPx: number) => Math.round(xPx / canvasScale);
  const ny = (yPx: number) => Math.round(yPx / canvasScale);

  useEffect(() => {
    if (!file) {
      setFilePreview("");
      setAnalysis(null);
      setSourceImage(null);
      setSourceImageData(null);
      setErrorMsg("");
      return;
    }

    const url = URL.createObjectURL(file);
    setFilePreview(url);

    const img = new window.Image();
    img.onload = () => {
      const w = Math.max(2, img.width);
      const h = Math.max(2, img.height);
      setImgMeta({ width: w, height: h });
      setLaneRegion([0, w - 1]);
      setAnalysis(null);
      setErrorMsg("");
      setSourceImage(img);

      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d");
      if (ctx) {
        ctx.drawImage(img, 0, 0);
        setSourceImageData(ctx.getImageData(0, 0, w, h));
      }
    };
    img.src = url;

    return () => URL.revokeObjectURL(url);
  }, [file]);

  const doAnalyze = useCallback(() => {
    if (!sourceImageData) return;
    if (!nLanesValid || !ladderLaneValid) return;
    if (ladderLane < 1 || ladderLane > nLanes) return;
    if (parsedLadderSizes.length === 0) return;

    const [x0, x1] = normalizedRegion;
    if (x1 <= x0) return;

    const runId = ++analyzeRunId.current;

    try {
      setIsAnalyzing(true);
      setErrorMsg("");

      const w = sourceImageData.width;
      const h = sourceImageData.height;

      const laneBounds = buildEqualLanes(x0, x1, nLanes);

      const gray = grayscaleFromImageData(sourceImageData);
      const prep = preprocessGray(gray, w, h, invert);

      const ladderIdx = ladderLane - 1;
      const ladderLaneBound = laneBounds[ladderIdx];

      const det = detectLadderBands(prep, w, h, ladderLaneBound, parsedLadderSizes.length, 8);

      if (runId !== analyzeRunId.current) return;

      setAnalysis({
        width: w,
        height: h,
        laneBounds,
        ladderYAuto: det.peaks,
        ladderSizesBp: parsedLadderSizes,
        mismatch: det.mismatch,
      });

      if (det.peaks.length === parsedLadderSizes.length) {
        setLadderY(det.peaks);
      } else {
        const n = parsedLadderSizes.length;
        const seed = Array.from({ length: n }, (_, i) =>
          Math.round((0.15 + (0.7 * i) / Math.max(1, n - 1)) * h)
        );
        setLadderY(seed);
      }
    } catch (err: any) {
      setErrorMsg(err?.message || "Analyze failed");
    } finally {
      setIsAnalyzing(false);
    }
  }, [
    sourceImageData,
    nLanesValid,
    ladderLaneValid,
    ladderLane,
    nLanes,
    parsedLadderSizes,
    normalizedRegion,
    invert,
  ]);

  useEffect(() => {
    if (!sourceImageData) return;
    const t = setTimeout(() => doAnalyze(), 350);
    return () => clearTimeout(t);
  }, [doAnalyze, sourceImageData]);

  const clampRegion = (x0: number, x1: number, width: number) => {
    let a = Math.max(0, Math.min(width - 2, x0));
    let b = Math.max(1, Math.min(width - 1, x1));
    if (b - a < 5) {
      if (a + 5 <= width - 1) b = a + 5;
      else a = b - 5;
    }
    return [a, b] as [number, number];
  };

  const doDownload = useCallback(async () => {
    if (!analysis || !sourceImage) return;
    if (ladderY.length !== analysis.ladderSizesBp.length) return;

    try {
      setIsAnnotating(true);
      setErrorMsg("");

      const w = analysis.width;
      const h = analysis.height;

      const scale = Math.max(1.0, Math.min(4.0, Math.pow(w / 900, 0.95)));
      const lanePx = Math.max(12, Math.round(20 * scale * laneTextScale));
      const ladderPx = Math.max(12, Math.round(19 * scale * ladderTextScale));

      const lineW = Math.max(1, Math.round(2.4 * scale));
      const tickW = Math.max(1, Math.round(1.4 * scale));
      const tickLen = Math.max(6, Math.round(9 * scale));

      const measureCanvas = document.createElement("canvas");
      const mctx = measureCanvas.getContext("2d")!;

      mctx.font = `${ladderPx}px "IBM Plex Mono"`;
      let widest = 0;
      for (const bp of analysis.ladderSizesBp) {
        widest = Math.max(widest, mctx.measureText(`${bp} bp`).width);
      }

      mctx.font = `${lanePx}px "Sora"`;
      let maxLaneLabelWidth = 0;
      for (const lbl of labelList) {
        maxLaneLabelWidth = Math.max(maxLaneLabelWidth, mctx.measureText(lbl).width);
      }

      const exportLaneAngleRad = (Math.abs(laneLabelAngle) * Math.PI) / 180;
      const rotatedLaneLabelHeight =
        Math.abs(maxLaneLabelWidth * Math.sin(exportLaneAngleRad)) + Math.abs(lanePx * Math.cos(exportLaneAngleRad));

      const leftPadOut = Math.max(Math.round(30 * scale), Math.round(widest + 26 * scale));
      const topPadOut = Math.max(Math.round(40 * scale), Math.round(rotatedLaneLabelHeight + 14 * scale));
      const rightPad = Math.round(20 * scale);
      const bottomPad = Math.round(20 * scale);

      const out = document.createElement("canvas");
      out.width = w + leftPadOut + rightPad;
      out.height = h + topPadOut + bottomPad;
      const ctx = out.getContext("2d")!;

      if (!transparentBg) {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, out.width, out.height);
      } else {
        ctx.clearRect(0, 0, out.width, out.height);
      }

      ctx.drawImage(sourceImage, leftPadOut, topPadOut, w, h);

      // lane boxes + labels
      for (let i = 0; i < analysis.laneBounds.length; i++) {
        const b = analysis.laneBounds[i];
        const isLadder = i === ladderLane - 1;
        const x0 = leftPadOut + b.x0;
        const x1 = leftPadOut + b.x1;
        const y0 = topPadOut;
        const y1 = topPadOut + h;

        if (showLaneBoxes) {
          ctx.strokeStyle = isLadder ? "#ff9f43" : "#4ea2ff";
          ctx.lineWidth = lineW;
          ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
        }

        const label = labelList[i] ?? `S ${i + 1}`;
        const cx = (x0 + x1) / 2;
        const cy = Math.max(rotatedLaneLabelHeight / 2 + 4 * scale, topPadOut * 0.52);

        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate((laneLabelAngle * Math.PI) / 180);
        ctx.font = `${lanePx}px "Sora"`;
        ctx.fillStyle = "#111111";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(label, 0, 0);
        ctx.restore();
      }

      // ladder axis + ticks + labels
      if (ladderY.length === analysis.ladderSizesBp.length) {
        const axisX = leftPadOut - Math.round(10 * scale);
        ctx.strokeStyle = "#e35c5c";
        ctx.lineWidth = tickW;
        ctx.beginPath();
        ctx.moveTo(axisX, topPadOut);
        ctx.lineTo(axisX, topPadOut + h);
        ctx.stroke();

        ctx.font = `${ladderPx}px "IBM Plex Mono"`;
        ctx.fillStyle = "#e35c5c";
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";

        for (let i = 0; i < analysis.ladderSizesBp.length; i++) {
          const bp = analysis.ladderSizesBp[i];
          const Y = topPadOut + ladderY[i];

          ctx.beginPath();
          ctx.moveTo(axisX, Y);
          ctx.lineTo(axisX + tickLen, Y);
          ctx.stroke();

          const txt = `${bp} bp`;
          const tw = ctx.measureText(txt).width;
          const tx = Math.max(4, axisX - tw - Math.round(8 * scale));
          ctx.fillText(txt, tx, Y);
        }
      }

      const blob: Blob | null = await new Promise((resolve) => out.toBlob((b) => resolve(b), "image/png"));
      if (!blob) throw new Error("Could not create PNG");

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const originalName = file?.name ?? "gel";
      const baseName = originalName.replace(/\.[^/.]+$/, "");
      a.download = `${baseName}_annotated.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      showToast("Annotated PNG exported", "success");
    } catch (err: any) {
      setErrorMsg(err?.message || "Annotate/download failed");
    } finally {
      setIsAnnotating(false);
    }
  }, [
    analysis,
    sourceImage,
    ladderY,
    ladderLane,
    labelList,
    showLaneBoxes,
    laneLabelAngle,
    transparentBg,
    laneTextScale,
    ladderTextScale,
    file,
  ]);

  const [regionX0, regionX1] = normalizedRegion;
  const canAnalyze = !!sourceImageData && nLanesValid && ladderLaneValid && parsedLadderSizes.length > 0;
  const laneBoundsValid = ladderLane >= 1 && ladderLane <= nLanes;

  const stageW = drawWidth + leftPad + 40;
  const stageH = drawHeight + topPad + bottomHandlePad + 24;

  return (
    <div className="saas-shell">
      <div className="app-grid">
        <aside className="panel panel-left project-assets reveal reveal-1">
          <div className="panel-head">
            <h2>Project Assets</h2>
            <p>Gel settings</p>
          </div>

          <div className="settings-section">
            <h3 className="settings-subhead">Input</h3>

            <div className="form-field">
              <label>Upload gel image</label>
              <input type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] || null)} />
            </div>

            <div className="form-grid-2">
              <div className="form-field">
                <label>Total lanes</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={nLanesInput}
                  onChange={(e) => {
                    const v = e.target.value.trim();
                    if (/^\d*$/.test(v)) setNLanesInput(v);
                  }}
                />
              </div>

              <div className="form-field">
                <label>Ladder lane</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={ladderLaneInput}
                  onChange={(e) => {
                    const v = e.target.value.trim();
                    if (/^\d*$/.test(v)) setLadderLaneInput(v);
                  }}
                />
              </div>
            </div>

            <label className="check">
              <input type="checkbox" checked={invert} onChange={(e) => setInvert(e.target.checked)} />
              Input image is inverted (negative)
            </label>
          </div>

          <div className="settings-section">
            <h3 className="settings-subhead">Ladder</h3>

            <div className="form-field">
              <label>Ladder presets</label>
              <select value={ladderPresetKey} onChange={(e) => applyPreset(e.target.value)}>
                {LADDER_PRESET_GROUPS.map((group) => (
                  <optgroup key={group.group} label={group.group}>
                    {group.presets.map((p) => (
                      <option key={p.key} value={p.key}>
                        {p.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>

            <div className="form-field">
              <label>Ladder band sizes (bp, top→bottom)</label>
              <input
                value={ladderSizes}
                onChange={(e) => setLadderSizes(e.target.value)}
                placeholder="e.g. 2000,1000,750,500,250,100"
              />
            </div>
          </div>

          <div className="settings-section">
            <h3 className="settings-subhead">Labels</h3>

            <div className="form-field">
              <label>Lane labels</label>
              <textarea rows={6} value={laneLabels} onChange={(e) => setLaneLabels(e.target.value)} />
            </div>

            <div className="form-field">
              <label>
                Lane label tilt: <strong>{laneLabelAngle}°</strong>
              </label>
              <input
                type="range"
                min={0}
                max={90}
                value={laneLabelAngle}
                onChange={(e) => setLaneLabelAngle(Number(e.target.value))}
              />
            </div>

            <div className="form-field">
              <label>
                Lane label size: <strong>{laneTextScale.toFixed(2)}×</strong>
              </label>
              <input
                type="range"
                min={0.6}
                max={2.0}
                step={0.05}
                value={laneTextScale}
                onChange={(e) => setLaneTextScale(Number(e.target.value))}
              />
            </div>

            <div className="form-field">
              <label>
                Ladder label size: <strong>{ladderTextScale.toFixed(2)}×</strong>
              </label>
              <input
                type="range"
                min={0.6}
                max={2.0}
                step={0.05}
                value={ladderTextScale}
                onChange={(e) => setLadderTextScale(Number(e.target.value))}
              />
            </div>
          </div>

          <div className="settings-section">
            <h3 className="settings-subhead">Display</h3>

            <div className="form-stack">
              <label className="check">
                <input type="checkbox" checked={showLaneBoxes} onChange={(e) => setShowLaneBoxes(e.target.checked)} />
                Show lane boxes
              </label>

              <label className="check">
                <input type="checkbox" checked={transparentBg} onChange={(e) => setTransparentBg(e.target.checked)} />
                Transparent background (PNG)
              </label>
            </div>
          </div>

          <div className="settings-section settings-section-export">
            <h3 className="settings-subhead">Export</h3>

            <p className="hint">Preview is scaled for editing. Export always uses native resolution.</p>

            {!canAnalyze && <div className="msg warn">Add image + valid lanes + valid ladder sizes.</div>}
            {canAnalyze && !laneBoundsValid && <div className="msg warn">Ladder lane must be between 1 and total lanes.</div>}
            {errorMsg && <div className="msg error">{errorMsg}</div>}

            <button className="download-btn" onClick={doDownload} disabled={!analysis || isAnnotating}>
              {isAnnotating ? "Generating PNG..." : "Generate & Download PNG"}
            </button>
          </div>
        </aside>

        <section className="workspace-main">
          <header className="topbar reveal reveal-0">
            <div className="brand">
              <div className="brand-dot" />
              <div>
                <h1>Automated Gel Annotation Tool</h1>
                <p>Automatic annotation of ladder bands and sample lanes</p>
              </div>
            </div>
            <div className="topbar-actions">
             <a
               className="icon-link"
               href="https://github.com/sxh1136/gel-annotator"
               target="_blank"
               rel="noopener noreferrer"
               aria-label="Open GitHub repository"
               title="View on GitHub"
             >
               <img
                  src="src/icons/github.png"
                  alt=""
                  width={18}
                  height={18}
                  loading="lazy"
                  referrerPolicy="no-referrer"
                />
             </a>

             <a
               className="icon-link"
               href="https://sfsho.carrd.co"
               target="_blank"
               rel="noopener noreferrer"
               aria-label="Open personal website"
               title="Visit personal website"
             >
               <img
                  src="src/icons/website.jpg"
                  alt=""
                  width={18}
                  height={18}
                  loading="lazy"
                  referrerPolicy="no-referrer"
                />
             </a>

              <button
                className="theme-toggle"
                onClick={() => setTheme((t) => (t === "light" ? "dark" : "light"))}
                type="button"
              >
                {theme === "light" ? "🌙 Dark mode" : "☀️ Light mode"}
              </button>
          </div>
        </header>

          {analysis?.mismatch && (
            <div className="global-alert global-alert-warn">
              <strong>Could not identify ladder bands correctly.</strong> Please check ladder preset, total lanes, and gel
              boundaries — or manually drag red ladder labels to calibrate.
            </div>
          )}

          <section className="panel panel-main reveal reveal-2">
            <div className="panel-head">
              <h2>Interactive editor</h2>
              <p>Set sample lane region (yellow) and manually adjust ladder bands (red)</p>
            </div>

            {!file && <div className="empty">Please upload an image.</div>}

            {file && (
              <div className="canvas-frame">
                <Stage width={stageW} height={stageH}>
                  <Layer>
                    <GelImage src={displayImageUrl} x={leftPad} y={topPad} w={drawWidth} h={drawHeight} />

                    <Rect
                      x={leftPad}
                      y={topPad}
                      width={drawWidth}
                      height={drawHeight}
                      stroke="rgba(0,0,0,0.18)"
                      strokeWidth={1}
                      listening={false}
                    />

                    <Rect
                      x={leftPad}
                      y={topPad}
                      width={Math.max(0, sx(regionX0))}
                      height={drawHeight}
                      fill="rgba(0,0,0,0.24)"
                    />
                    <Rect
                      x={leftPad + sx(regionX1)}
                      y={topPad}
                      width={Math.max(0, drawWidth - sx(regionX1))}
                      height={drawHeight}
                      fill="rgba(0,0,0,0.24)"
                    />

                    {showLaneBoxes &&
                      laneBoundsToDraw.map((b, i) => {
                        const isLadder = i === ladderLane - 1;
                        return (
                          <Group key={`lane-${i}`}>
                            {isLadder && (
                              <Rect
                                x={leftPad + sx(b.x0)}
                                y={topPad}
                                width={Math.max(1, sx(b.x1 - b.x0))}
                                height={drawHeight}
                                fill="rgba(255,159,67,0.10)"
                              />
                            )}
                            <Rect
                              x={leftPad + sx(b.x0)}
                              y={topPad}
                              width={Math.max(1, sx(b.x1 - b.x0))}
                              height={drawHeight}
                              stroke={isLadder ? "#ff9f43" : "#4ea2ff"}
                              strokeWidth={isLadder ? laneBoxStroke + 1 : laneBoxStroke}
                            />
                          </Group>
                        );
                      })}

                    {/* Start boundary */}
                    <Group
                      x={leftPad + sx(regionX0)}
                      y={topPad}
                      draggable
                      dragBoundFunc={(pos) => ({
                        x: Math.max(
                          leftPad,
                          Math.min(leftPad + sx(regionX1) - Math.max(4, Math.round(5 * canvasScale)), pos.x)
                        ),
                        y: topPad,
                      })}
                      onDragMove={(e) => {
                        const nativeX0 = nx(e.target.x() - leftPad);
                        setLaneRegion((prev) => clampRegion(nativeX0, prev[1], nativeWidth));
                      }}
                    >
                      <Rect x={-12} y={0} width={24} height={drawHeight + bottomHandlePad} fill="rgba(0,0,0,0)" />
                      <Line points={[0, 0, 0, drawHeight]} stroke="#e9be3a" strokeWidth={laneBoxStroke + 1} />
                      <Rect
                        x={-Math.round(handleW / 2)}
                        y={drawHeight + 6}
                        width={handleW}
                        height={handleH}
                        cornerRadius={4}
                        fill="#e9be3a"
                      />
                      <Text
                        x={-Math.round(16 * uiScale)}
                        y={drawHeight + 6 + handleH + 2}
                        text="Start"
                        fill="#111111"
                        fontSize={smallLabelFont}
                      />
                    </Group>

                    {/* End boundary */}
                    <Group
                      x={leftPad + sx(regionX1)}
                      y={topPad}
                      draggable
                      dragBoundFunc={(pos) => ({
                        x: Math.max(
                          leftPad + sx(regionX0) + Math.max(4, Math.round(5 * canvasScale)),
                          Math.min(leftPad + drawWidth - 1, pos.x)
                        ),
                        y: topPad,
                      })}
                      onDragMove={(e) => {
                        const nativeX1 = nx(e.target.x() - leftPad);
                        setLaneRegion((prev) => clampRegion(prev[0], nativeX1, nativeWidth));
                      }}
                    >
                      <Rect x={-12} y={0} width={24} height={drawHeight + bottomHandlePad} fill="rgba(0,0,0,0)" />
                      <Line points={[0, 0, 0, drawHeight]} stroke="#e9be3a" strokeWidth={laneBoxStroke + 1} />
                      <Rect
                        x={-Math.round(handleW / 2)}
                        y={drawHeight + 6}
                        width={handleW}
                        height={handleH}
                        cornerRadius={4}
                        fill="#e9be3a"
                      />
                      <Text
                        x={-Math.round(12 * uiScale)}
                        y={drawHeight + 6 + handleH + 2}
                        text="End"
                        fill="#111111"
                        fontSize={smallLabelFont}
                      />
                    </Group>

                    <Line
                      points={[
                        leftPad - Math.round(10 * uiScale),
                        topPad,
                        leftPad - Math.round(10 * uiScale),
                        topPad + drawHeight,
                      ]}
                      stroke="#e35c5c"
                      strokeWidth={axisStroke}
                    />

                    {laneBoundsToDraw.map((b, i) => {
                      const label = labelList[i] ?? `S ${i + 1}`;
                      const cx = leftPad + sx((b.x0 + b.x1) / 2);
                      const labelY = Math.round(topPad * 0.62);
                      const approxTextW = Math.max(12, label.length * laneLabelFont * 0.58);

                      return (
                        <Text
                          key={`lane-label-${i}`}
                          x={cx}
                          y={labelY}
                          text={label}
                          fill="#111111"
                          fontSize={laneLabelFont}
                          fontFamily="Sora"
                          rotation={laneLabelAngle}
                          offsetX={approxTextW / 2}
                          offsetY={laneLabelFont / 2}
                          listening={false}
                        />
                      );
                    })}

                    {analysis &&
                      analysis.ladderSizesBp.map((bp, i) => {
                        const yNative = ladderY[i] ?? 20;
                        const yScreen = sy(yNative);
                        const yOffset = Math.round(9 * uiScale);

                        return (
                          <Group key={`ladder-${i}`}>
                            <Line
                              points={[
                                leftPad - Math.round(10 * uiScale),
                                topPad + yScreen,
                                leftPad - Math.round(2 * uiScale),
                                topPad + yScreen,
                              ]}
                              stroke="#e35c5c"
                              strokeWidth={axisStroke}
                            />
                            <Text
                              x={Math.round(10 * uiScale)}
                              y={topPad + yScreen - yOffset}
                              text={`${bp} bp`}
                              fill="#e35c5c"
                              fontSize={ladderLabelFont}
                              fontFamily="IBM Plex Mono"
                              draggable
                              dragBoundFunc={(pos) => ({
                                x: Math.round(10 * uiScale),
                                y: Math.max(topPad, Math.min(topPad + drawHeight - Math.round(14 * uiScale), pos.y)),
                              })}
                              onDragMove={(e) => {
                                const nativeY = ny(e.target.y() - topPad + yOffset);
                                setLadderY((prev) => {
                                  const copy = [...prev];
                                  copy[i] = Math.max(0, Math.min(nativeHeight - 1, nativeY));
                                  return copy;
                                });
                              }}
                            />
                          </Group>
                        );
                      })}
                  </Layer>
                </Stage>
              </div>
            )}
          </section>

          <footer className="app-footer">
            <span>© Siu Fung Stanley Ho 2026. All rights reserved.</span>
          </footer>
        </section>
      </div>

      {toast && <div className={`toast toast-${toast.type}`}>{toast.message}</div>}
    </div>
  );
}