/**
 * Mermaid theme variables derived from the app palette.
 *
 * Mermaid's built-in themes are saturated and cool; every diagram type is
 * re-tinted here onto the same warm, low-contrast surface as the prose, so a
 * flowchart reads as part of the page rather than a screenshot pasted into it.
 */

const LIGHT = {
  bg: '#FAF9F5',
  surface: '#EFEDE4',
  surfaceAlt: '#F3F1EA',
  raised: '#FFFEFB',
  text: '#2C2A26',
  textDim: '#6B6862',
  border: '#D3CFC1',
  borderSoft: '#E4E1D7',
  line: '#8D8A82',
  accent: '#B5602F',
  series: ['#B5602F', '#3F6B8F', '#4F7245', '#6D5A91', '#9A6A1C', '#A3452F',
    '#5C7F86', '#8A6A4B', '#7C6E93', '#57734F', '#9C6B5A', '#4E6272'],
};

const DARK = {
  bg: '#1E1D1B',
  // Node fills sit a step lighter than the app's code background so shapes read
  // against the diagram card without turning into bright boxes.
  surface: '#34322D',
  surfaceAlt: '#2A2926',
  raised: '#262523',
  text: '#EDEAE3',
  textDim: '#9C988F',
  border: '#45423C',
  borderSoft: '#35332F',
  line: '#7D7A72',
  accent: '#D98756',
  series: ['#D98756', '#7FA8C9', '#8FB082', '#AB97CF', '#D2A45C', '#DD8A72',
    '#8AB3B8', '#C4A184', '#B0A3CB', '#93B587', '#CF9A88', '#8296A8'],
};

const FONT_SANS =
  'ui-sans-serif, -apple-system, "Segoe UI Variable Text", "Segoe UI", Inter, "Noto Sans", sans-serif';
const FONT_MONO =
  'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';

/** Build the full themeVariables object for one palette. */
function variables(p) {
  const series = {};
  p.series.forEach((color, i) => {
    series[`pie${i + 1}`] = color;
    series[`cScale${i}`] = color;
    series[`cScaleLabel${i}`] = p.bg;
    series[`git${i}`] = color;
    series[`gitBranchLabel${i}`] = p.bg;
    series[`surface${i}`] = color;
  });

  return {
    darkMode: p === DARK,
    fontFamily: FONT_SANS,
    fontSize: '14px',

    /* --- shared -------------------------------------------------------- */
    background: p.bg,
    primaryColor: p.surface,
    primaryTextColor: p.text,
    primaryBorderColor: p.border,
    secondaryColor: p.surfaceAlt,
    secondaryTextColor: p.text,
    secondaryBorderColor: p.borderSoft,
    tertiaryColor: p.raised,
    tertiaryTextColor: p.textDim,
    tertiaryBorderColor: p.borderSoft,
    lineColor: p.line,
    textColor: p.text,
    mainBkg: p.surface,
    nodeBorder: p.border,
    nodeTextColor: p.text,
    titleColor: p.text,
    edgeLabelBackground: p.bg,
    clusterBkg: p.surfaceAlt,
    clusterBorder: p.borderSoft,
    defaultLinkColor: p.line,
    errorBkgColor: p.surface,
    errorTextColor: p.accent,

    /* --- flowchart ----------------------------------------------------- */
    arrowheadColor: p.line,

    /* --- sequence ------------------------------------------------------ */
    actorBkg: p.surface,
    actorBorder: p.border,
    actorTextColor: p.text,
    actorLineColor: p.line,
    signalColor: p.text,
    signalTextColor: p.text,
    labelBoxBkgColor: p.surfaceAlt,
    labelBoxBorderColor: p.border,
    labelTextColor: p.text,
    loopTextColor: p.textDim,
    activationBkgColor: p.raised,
    activationBorderColor: p.border,
    sequenceNumberColor: p.bg,
    noteBkgColor: p.raised,
    noteBorderColor: p.accent,
    noteTextColor: p.text,

    /* --- state / class ------------------------------------------------- */
    labelColor: p.text,
    altBackground: p.surfaceAlt,
    compositeBackground: p.surfaceAlt,
    compositeTitleBackground: p.surface,
    compositeBorder: p.border,
    innerEndBackground: p.text,
    specialStateColor: p.accent,
    transitionColor: p.line,
    transitionLabelColor: p.text,
    stateBkg: p.surface,
    stateLabelColor: p.text,
    classText: p.text,

    /* --- ER ------------------------------------------------------------ */
    attributeBackgroundColorEven: p.bg,
    attributeBackgroundColorOdd: p.surfaceAlt,

    /* --- gantt --------------------------------------------------------- */
    sectionBkgColor: p.surfaceAlt,
    sectionBkgColor2: p.bg,
    altSectionBkgColor: p.bg,
    gridColor: p.borderSoft,
    todayLineColor: p.accent,
    taskBkgColor: p.surface,
    taskBorderColor: p.border,
    taskTextColor: p.text,
    taskTextLightColor: p.text,
    taskTextOutsideColor: p.textDim,
    taskTextDarkColor: p.text,
    taskTextClickableColor: p.accent,
    activeTaskBkgColor: p.accent,
    activeTaskBorderColor: p.accent,
    doneTaskBkgColor: p.surfaceAlt,
    doneTaskBorderColor: p.line,
    critBkgColor: p.accent,
    critBorderColor: p.accent,
    excludeBkgColor: p.surfaceAlt,

    /* --- journey ------------------------------------------------------- */
    fillType0: p.series[0],
    fillType1: p.series[1],
    fillType2: p.series[2],
    fillType3: p.series[3],
    fillType4: p.series[4],
    fillType5: p.series[5],
    fillType6: p.series[6],
    fillType7: p.series[7],

    /* --- quadrant ------------------------------------------------------ */
    quadrant1Fill: p.surfaceAlt,
    quadrant2Fill: p.bg,
    quadrant3Fill: p.surfaceAlt,
    quadrant4Fill: p.bg,
    quadrant1TextFill: p.text,
    quadrant2TextFill: p.text,
    quadrant3TextFill: p.text,
    quadrant4TextFill: p.text,
    quadrantPointFill: p.accent,
    quadrantPointTextFill: p.text,
    quadrantXAxisTextFill: p.textDim,
    quadrantYAxisTextFill: p.textDim,
    quadrantInternalBorderStrokeFill: p.borderSoft,
    quadrantExternalBorderStrokeFill: p.border,
    quadrantTitleFill: p.text,

    /* --- xychart ------------------------------------------------------- */
    xyChart: {
      backgroundColor: p.bg,
      titleColor: p.text,
      xAxisLabelColor: p.textDim,
      xAxisTitleColor: p.text,
      xAxisTickColor: p.borderSoft,
      xAxisLineColor: p.line,
      yAxisLabelColor: p.textDim,
      yAxisTitleColor: p.text,
      yAxisTickColor: p.borderSoft,
      yAxisLineColor: p.line,
      plotColorPalette: p.series.join(', '),
    },

    /* --- requirement --------------------------------------------------- */
    requirementBackground: p.surface,
    requirementBorderColor: p.border,
    requirementTextColor: p.text,
    relationColor: p.line,
    relationLabelBackground: p.bg,
    relationLabelColor: p.text,

    /* --- git ----------------------------------------------------------- */
    commitLabelColor: p.text,
    commitLabelBackground: p.bg,
    commitLabelFontSize: '12px',
    tagLabelColor: p.text,
    tagLabelBackground: p.surfaceAlt,
    tagLabelBorder: p.border,
    tagLabelFontSize: '11px',

    /* --- pie ----------------------------------------------------------- */
    pieTitleTextColor: p.text,
    pieSectionTextColor: p.text,
    pieOuterStrokeColor: p.border,
    pieStrokeColor: p.bg,
    pieOpacity: 0.82,
    pieLegendTextColor: p.textDim,

    /* --- mindmap / timeline / radar ------------------------------------ */
    cScale0: p.series[0],
    radar: {
      axisColor: p.borderSoft,
      axisStrokeWidth: 1,
      axisLabelFontSize: '12px',
      curveOpacity: 0.28,
      curveStrokeWidth: 2,
      graticuleColor: p.borderSoft,
      graticuleOpacity: 0.4,
      legendBoxSize: 10,
      legendFontSize: '12px',
    },

    /* --- monospaced content ------------------------------------------- */
    classFontFamily: FONT_MONO,
    ...series,
  };
}

/** Full mermaid config for a theme. */
export function mermaidConfig(isDark) {
  return {
    startOnLoad: false,
    // Encodes HTML in labels and disables click bindings: a Markdown file is
    // untrusted input, and nothing in a reader needs diagram callbacks.
    securityLevel: 'strict',
    suppressErrorRendering: true,
    deterministicIds: false,
    maxTextSize: 120000,
    maxEdges: 1200,
    theme: 'base',
    fontFamily: FONT_SANS,
    altFontFamily: FONT_SANS,
    themeVariables: variables(isDark ? DARK : LIGHT),
    flowchart: { htmlLabels: true, curve: 'basis', padding: 12, useMaxWidth: false, diagramPadding: 8 },
    sequence: { useMaxWidth: false, diagramMarginX: 24, diagramMarginY: 16, actorFontFamily: FONT_SANS, noteFontFamily: FONT_SANS, messageFontFamily: FONT_SANS, wrap: false },
    gantt: { useMaxWidth: false, fontSize: 13, sectionFontSize: 13, leftPadding: 90, gridLineStartPadding: 30 },
    class: { useMaxWidth: false },
    state: { useMaxWidth: false },
    er: { useMaxWidth: false, layoutDirection: 'TB', entityPadding: 14 },
    journey: { useMaxWidth: false },
    pie: { useMaxWidth: false, textPosition: 0.6 },
    quadrantChart: { useMaxWidth: false },
    requirement: { useMaxWidth: false },
    mindmap: { useMaxWidth: false, padding: 12 },
    timeline: { useMaxWidth: false },
    gitGraph: { useMaxWidth: false, showBranches: true, showCommitLabel: true },
    c4: { useMaxWidth: false },
    sankey: { useMaxWidth: false, showValues: true },
    xyChart: { useMaxWidth: false },
    block: { useMaxWidth: false, padding: 10 },
    packet: { useMaxWidth: false },
    architecture: { useMaxWidth: false, padding: 30 },
    radar: { useMaxWidth: false },
    treemap: { useMaxWidth: false },
    kanban: { useMaxWidth: false },
  };
}
