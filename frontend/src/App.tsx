import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { Group, Image as KonvaImage, Layer, Line, Rect, Stage, Text } from "react-konva";
import "./App.css";
import { LADDER_PRESET_GROUPS } from "./data/ladderPresets";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

type LaneBound = { x0: number; x1: number };

type AnalysisResponse = {
  imageId: string;
  imageUrl: string;
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

  // native coordinates
  const [laneRegion, setLaneRegion] = useState<[number, number]>([0, 999]);
  const [ladderY, setLadderY] = useState<number[]>([]);

  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isAnnotating, setIsAnnotating] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [toast, setToast] = useState<ToastState>(null);
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    const saved = localStorage.getItem("gel-theme");
    return saved === "dark" ? "dark" : "light";
  });

  const analyzeRunId = useRef(0);
  const annotateRunId = useRef(0);

  const showToast = (message: string, type: "info" | "success" = "info") => {
    setToast({ type, message });
    window.setTimeout(() => setToast(null), 2200);
  };

  const nLanesValid = /^\d+$/.test(nLanesInput) && Number(nLanesInput) >= 1;
  const ladderLaneValid = /^\d+$/.test(ladderLaneInput) && Number(ladderLaneInput) >= 1;
  const nLanes = nLanesValid ? Number(nLanesInput) : 1;
  const ladderLane = ladderLaneValid ? Number(ladderLaneInput) : 1;

  const parsedLadderSizes = useMemo(() => {
    return ladderSizes
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => Number(s))
      .filter((n) => Number.isFinite(n) && n > 0);
  }, [ladderSizes]);

  // Preset map
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

  // If user manually edits a selected preset, switch to custom
  useEffect(() => {
    if (ladderPresetKey === "custom") return;
    const p = presetMap.get(ladderPresetKey);
    if (!p) return;
    const presetString = p.sizes.join(",");
    const normalizedCurrent = ladderSizes.replace(/\s+/g, "");
    if (normalizedCurrent !== presetString) {
      setLadderPresetKey("custom");
    }
  }, [ladderSizes, ladderPresetKey, presetMap]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("gel-theme", theme);
  }, [theme]);

  const nativeWidth = analysis?.width ?? imgMeta.width;
  const nativeHeight = analysis?.height ?? imgMeta.height;

  // Preview fit (visual only)
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

  const leftPad = Math.round(130 * uiScale);
  const topPad = Math.max(Math.round(68 * uiScale), Math.round(laneLabelFont * 2.6));
  const bottomHandlePad = Math.round(52 * uiScale);

  const displayImageUrl = analysis ? `${API}${analysis.imageUrl}` : filePreview;

  const normalizedRegion = useMemo<[number, number]>(() => {
    const a = Math.min(laneRegion[0], laneRegion[1]);
    const b = Math.max(laneRegion[0], laneRegion[1]);
    return [a, b];
  }, [laneRegion]);

  const labelList = useMemo(() => {
    const arr = laneLabels.split("\n").map((x) => x.trim()).filter(Boolean);
    while (arr.length < nLanes) arr.push(`S ${arr.length + 1}`);
    return arr.slice(0, nLanes);
  }, [laneLabels, nLanes]);

  const provisionalLaneBounds = useMemo(() => {
    const [x0, x1] = normalizedRegion;
    const xs = Array.from({ length: nLanes + 1 }, (_, i) =>
      Math.round(x0 + ((x1 - x0) * i) / nLanes)
    );
    const out: LaneBound[] = [];
    for (let i = 0; i < nLanes; i++) out.push({ x0: xs[i], x1: xs[i + 1] });
    return out;
  }, [normalizedRegion, nLanes]);

  const laneBoundsToDraw = analysis?.laneBounds ?? provisionalLaneBounds;

  // Native <-> screen transforms
  const sx = (x: number) => Math.round(x * canvasScale);
  const sy = (y: number) => Math.round(y * canvasScale);
  const nx = (xPx: number) => Math.round(xPx / canvasScale);
  const ny = (yPx: number) => Math.round(yPx / canvasScale);

  useEffect(() => {
    if (!file) {
      setFilePreview("");
      setAnalysis(null);
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
    };
    img.src = url;

    return () => URL.revokeObjectURL(url);
  }, [file]);

  const doAnalyze = useCallback(async () => {
    if (!file) return;
    if (!nLanesValid || !ladderLaneValid) return;
    if (ladderLane < 1 || ladderLane > nLanes) return;
    if (parsedLadderSizes.length === 0) return;

    const [x0, x1] = normalizedRegion;
    if (x1 <= x0) return;

    const runId = ++analyzeRunId.current;

    try {
      setIsAnalyzing(true);
      setErrorMsg("");

      const form = new FormData();
      form.append("image", file);
      form.append("n_lanes", String(nLanes));
      form.append("ladder_lane", String(ladderLane));
      form.append("ladder_sizes", parsedLadderSizes.join(","));
      form.append("x0", String(x0));
      form.append("x1", String(x1));
      form.append("invert", String(invert));

      form.append("clahe_clip", "2.0");
      form.append("blur_k", "3");
      form.append("prominence", "12");
      form.append("min_dist", "8");
      form.append("smooth_sigma", "2.0");

      const { data } = await axios.post<AnalysisResponse>(`${API}/api/analyze`, form);
      if (runId !== analyzeRunId.current) return;

      setAnalysis(data);

      if (data.ladderYAuto.length === data.ladderSizesBp.length) {
        setLadderY(data.ladderYAuto);
      } else {
        const n = data.ladderSizesBp.length;
        const seed = Array.from({ length: n }, (_, i) =>
          Math.round((0.15 + (0.7 * i) / Math.max(1, n - 1)) * data.height)
        );
        setLadderY(seed);
      }
    } catch (err: any) {
      if (runId !== analyzeRunId.current) return;
      setErrorMsg(err?.response?.data?.detail || err.message || "Analyze failed");
    } finally {
      if (runId === analyzeRunId.current) setIsAnalyzing(false);
    }
  }, [
    file,
    nLanesValid,
    ladderLaneValid,
    ladderLane,
    nLanes,
    parsedLadderSizes,
    normalizedRegion,
    invert,
  ]);

  // Auto-analyze on changes
  useEffect(() => {
    if (!file) return;
    const t = setTimeout(() => doAnalyze(), 450);
    return () => clearTimeout(t);
  }, [doAnalyze, file]);

  const doAnnotate = useCallback(async () => {
    if (!analysis) return;
    if (ladderY.length !== analysis.ladderSizesBp.length) return;

    const runId = ++annotateRunId.current;

    try {
      setIsAnnotating(true);
      setErrorMsg("");

      const payload = {
        imageId: analysis.imageId,
        nLanes,
        ladderLane,
        ladderSizesBp: analysis.ladderSizesBp,
        laneLabels: labelList,
        ladderY,
        laneBounds: analysis.laneBounds,
        showLaneBoxes,
        laneLabelAngle,
        transparentBackground: transparentBg,
        laneTextScale,
        ladderTextScale,
      };

      const { data } = await axios.post(`${API}/api/annotate`, payload);
      if (runId !== annotateRunId.current) return;
      if (!data?.annotatedUrl) throw new Error("No annotatedUrl returned");

      const url = `${API}${data.annotatedUrl}?t=${Date.now()}`;
      const a = document.createElement("a");
      a.href = url;
      a.download = transparentBg ? "gel_annotated_transparent.png" : "gel_annotated.png";
      document.body.appendChild(a);
      a.click();
      a.remove();

      showToast("Annotated PNG exported", "success");
    } catch (err: any) {
      if (runId !== annotateRunId.current) return;
      setErrorMsg(err?.response?.data?.detail || err.message || "Annotate failed");
    } finally {
      if (runId === annotateRunId.current) setIsAnnotating(false);
    }
  }, [
    analysis,
    ladderY,
    nLanes,
    ladderLane,
    labelList,
    showLaneBoxes,
    laneLabelAngle,
    transparentBg,
    laneTextScale,
    ladderTextScale,
  ]);

  const clampRegion = (x0: number, x1: number, width: number) => {
    let a = Math.max(0, Math.min(width - 2, x0));
    let b = Math.max(1, Math.min(width - 1, x1));
    if (b - a < 5) {
      if (a + 5 <= width - 1) b = a + 5;
      else a = b - 5;
    }
    return [a, b] as [number, number];
  };

  const [regionX0, regionX1] = normalizedRegion;
  const canAnalyze = !!file && nLanesValid && ladderLaneValid && parsedLadderSizes.length > 0;
  const laneBoundsValid = ladderLane >= 1 && ladderLane <= nLanes;

  const stageW = drawWidth + leftPad + 40;
  const stageH = drawHeight + topPad + bottomHandlePad + 24;

  return (
    <div className="saas-shell">
      <header className="topbar reveal reveal-0">
        <div className="brand">
          <div className="brand-dot" />
          <div>
            <h1>Automated Gel Annotation Tool</h1>
            <p>Automated ladder and lane labelling</p>
          </div>
        </div>
        
        <button
          className="theme-toggle"
          onClick={() => setTheme((t) => (t === "light" ? "dark" : "light"))}
          type="button"
        >
          {theme === "light" ? "🌙 Dark mode" : "☀️ Light mode"}
        </button>
      </header>
      

      {analysis?.mismatch && (
        <div className="global-alert global-alert-warn">
          <strong>Ladder mismatch detected.</strong> Automatic ladder detection did not match expected bands.
          Check ladder preset, lane index, and boundaries — or manually drag red ladder labels to calibrate.
        </div>
      )}

      <main className="workspace">
        <aside className="panel panel-left reveal reveal-1">
          <div className="panel-head">
            <h2>Gel Settings</h2>
            <p>Updates analyze automatically</p>
          </div>

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
            <p className="hint">You can always type custom values even after selecting a preset.</p>
          </div>

          <div className="form-field">
            <label>Lane labels</label>
            <textarea rows={6} value={laneLabels} onChange={(e) => setLaneLabels(e.target.value)} />
          </div>

          <div className="form-stack">
            <label className="check">
              <input type="checkbox" checked={invert} onChange={(e) => setInvert(e.target.checked)} />
              Inverted image
            </label>

            <label className="check">
              <input type="checkbox" checked={showLaneBoxes} onChange={(e) => setShowLaneBoxes(e.target.checked)} />
              Show lane boxes
            </label>

            <label className="check">
              <input type="checkbox" checked={transparentBg} onChange={(e) => setTransparentBg(e.target.checked)} />
              Transparent background (PNG)
            </label>
          </div>

          <div className="form-field">
            <label>
              Lane label tilt: <strong>{laneLabelAngle}°</strong>
            </label>
            <input
              type="range"
              min={0}
              max={75}
              value={laneLabelAngle}
              onChange={(e) => setLaneLabelAngle(Number(e.target.value))}
            />
            <p className="hint">Lower = flatter labels, higher = steeper labels</p>
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

          <p className="hint">Preview is scaled for editing. Export always uses native resolution.</p>

          {!canAnalyze && <div className="msg warn">Add image + valid lanes + valid ladder sizes.</div>}
          {canAnalyze && !laneBoundsValid && (
            <div className="msg warn">Ladder lane must be between 1 and total lanes.</div>
          )}
          {errorMsg && <div className="msg error">{errorMsg}</div>}

          <button className="download-btn" onClick={doAnnotate} disabled={!analysis || isAnnotating}>
            {isAnnotating ? "Generating PNG..." : "Generate & Download PNG"}
          </button>
          <p className="hint">Uses current editor settings and ladder positions.</p>
        </aside>

        <section className="panel panel-main reveal reveal-2">
          <div className="panel-head">
            <h2>Interactive editor</h2>
            <p>Set lane region (yellow) and calibrate ladder bands (red)</p>
          </div>

          {!file && <div className="empty">Upload an image to begin.</div>}

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
                      fill="#e9be3a"
                      fontSize={smallLabelFont}
                    />
                  </Group>

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
                      fill="#e9be3a"
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
                            fontFamily="Sora"
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
      </main>

      {toast && <div className={`toast toast-${toast.type}`}>{toast.message}</div>}
    </div>
  );
}