(() => {
  const DEFAULTS = {
    fmvFeed: "./data/mini_fmv_player_values.csv",
    fmvwFeed: "./data/fmvw_top200_2526.csv",
    teamComparisonFeed: "./data/basketball_ops_comparison_summary.json",
    leagueTableFeed: "./data/league_table.json",
    salaryCap: 154647000,
    teamCount: 30,
    rosterSlots: 12,
    sims: 500,
    seed: 42,
    noiseSigma: 0.45,
    replacementSalary: 2000000,
    salaryPerWin: 4000000,
  };

  const SLOT_WEIGHTS = [0.26, 0.16, 0.12, 0.10, 0.08, 0.07, 0.06, 0.05, 0.04, 0.03, 0.02, 0.01];
  const FEATURE_SPECS = [
    ["PTS", "context_neutral_PTS"],
    ["REB", "context_neutral_REB"],
    ["AST", "context_neutral_AST"],
    ["STL", "context_neutral_STL"],
    ["BLK", "context_neutral_BLK"],
    ["THREE_PM", "context_neutral_THREE_PM"],
    ["TO", "context_neutral_TO"],
    ["FG_PCT", "context_neutral_FG_PCT"],
    ["FT_PCT", "context_neutral_FT_PCT"],
    ["USG_PCT", "context_neutral_USG_PCT"],
    ["projected_games", "projected_games"],
    ["projected_minutes", "projected_minutes"],
  ];

  const DEFAULT_WEIGHTS = {
    points: 3.0,
    rebounds: 2.0,
    assists: 2.5,
    steals: 3.0,
    blocks: 3.0,
    threes: 1.5,
    turnovers: -1.5,
    fg_pct: 1.0,
    ft_pct: 0.75,
    usage: 0.5,
    games: 1.5,
    minutes: 0.75,
  };

  const OFFENSE_PROXY_WEIGHTS = {
    points: 2.0,
    assists: 1.5,
    tpm: 1.0,
    fg_pct: 0.75,
    ft_pct: 0.5,
    turnovers: -1.0,
  };

  const DEFENSE_PROXY_WEIGHTS = {
    rebounds: 0.1,
    steals: 3.0,
    blocks: 5.5,
    turnovers: -2.0,
  };

  const PROXY_WINS_WEIGHTS = {
    offense: 0.30,
    defense: 0.20,
  };

  const NUMBER = (value, fallback = 0) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  };

  const CLAMP = (value, min, max) => Math.min(max, Math.max(min, value));

  function mulberry32(seed) {
    let t = seed >>> 0;
    return function rng() {
      t += 0x6D2B79F5;
      let r = Math.imul(t ^ (t >>> 15), 1 | t);
      r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }

  function gaussian(rng) {
    let u = 0;
    let v = 0;
    while (u === 0) u = rng();
    while (v === 0) v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  function parseCSV(text) {
    const rows = [];
    let row = [];
    let cell = "";
    let inQuotes = false;
    let i = 0;
    const pushCell = () => {
      row.push(cell);
      cell = "";
    };
    const pushRow = () => {
      if (row.length) rows.push(row);
      row = [];
    };
    while (i < text.length) {
      const ch = text[i];
      const next = text[i + 1];
      if (inQuotes) {
        if (ch === '"' && next === '"') {
          cell += '"';
          i += 1;
        } else if (ch === '"') {
          inQuotes = false;
        } else {
          cell += ch;
        }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        pushCell();
      } else if (ch === "\n") {
        pushCell();
        pushRow();
      } else if (ch === "\r") {
        // ignore
      } else {
        cell += ch;
      }
      i += 1;
    }
    pushCell();
    pushRow();
    if (!rows.length) return [];
    const headers = rows.shift().map((h) => h.trim());
    return rows
      .filter((parts) => parts.some((part) => String(part).trim() !== ""))
      .map((parts) => {
        const out = {};
        headers.forEach((header, idx) => {
          out[header] = parts[idx] !== undefined ? parts[idx] : "";
        });
        return out;
      });
  }

  function escapeCSV(value) {
    const text = value === null || value === undefined ? "" : String(value);
    if (/[",\n\r]/.test(text)) {
      return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
  }

  function escapeHTML(value) {
    return String(value === null || value === undefined ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function toCSV(rows, columns) {
    if (!rows.length) return "";
    const headers = columns || Object.keys(rows[0]);
    const lines = [headers.join(",")];
    for (const row of rows) {
      lines.push(headers.map((col) => escapeCSV(row[col])).join(","));
    }
    return `${lines.join("\n")}\n`;
  }

  function formatCurrency(value) {
    if (!Number.isFinite(value)) return "--";
    return `$${Math.round(value).toLocaleString("en-US")}`;
  }

  function formatFloat(value, digits = 2) {
    if (!Number.isFinite(value)) return "--";
    return Number(value).toFixed(digits);
  }

  function mean(values) {
    if (!values.length) return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  function std(values) {
    if (values.length <= 1) return 0;
    const avg = mean(values);
    const variance = mean(values.map((value) => (value - avg) ** 2));
    return Math.sqrt(variance);
  }

  function quantile(values, percentile) {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const index = (sorted.length - 1) * percentile;
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    if (lower === upper) return sorted[lower];
    return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
  }

  function groupBy(rows, key) {
    const map = new Map();
    for (const row of rows) {
      const value = String(row[key] || "ALL").trim().toUpperCase() || "ALL";
      if (!map.has(value)) map.set(value, []);
      map.get(value).push(row);
    }
    return map;
  }

  function numeric(row, key, fallback = 0) {
    return NUMBER(row[key], fallback);
  }

  function zScore(value, avg, deviation) {
    if (!Number.isFinite(value)) return 0;
    if (!Number.isFinite(deviation) || deviation <= 0) return 0;
    return (value - avg) / deviation;
  }

  function buildPreparedRows(rawRows, config) {
    const rows = rawRows.map((row) => ({ ...row }));
    const groups = groupBy(rows, "position");
    const statsByGroup = new Map();

    for (const [group, members] of groups.entries()) {
      const stat = {};
      for (const [feature, source] of FEATURE_SPECS) {
        const values = members.map((row) => numeric(row, source, source === "projected_games" ? 65 : source === "projected_minutes" ? 24 : 0));
        stat[feature] = { mean: mean(values), std: std(values) };
      }
      statsByGroup.set(group, stat);
    }

    return rows.map((row) => {
      const group = String(row.position || "ALL").trim().toUpperCase() || "ALL";
      const stats = statsByGroup.get(group) || statsByGroup.get("ALL") || {};
      const prepared = { ...row };
      for (const [feature, source] of FEATURE_SPECS) {
        const fallback = source === "projected_games" ? 65 : source === "projected_minutes" ? 24 : 0;
        const value = numeric(row, source, fallback);
        prepared[`z_${feature}`] = zScore(value, stats[feature]?.mean ?? 0, stats[feature]?.std ?? 0);
        if (source === "projected_games" || source === "projected_minutes") {
          prepared[source] = value;
        }
      }
      prepared.weighted_score = scoreRow(prepared, config.weights);
      prepared.projected_games_used = numeric(prepared, "projected_games", 65);
      prepared.position = group;
      return prepared;
    });
  }

  function scoreRow(row, weights) {
    return (
      weights.points * numeric(row, "z_PTS") +
      weights.rebounds * numeric(row, "z_REB") +
      weights.assists * numeric(row, "z_AST") +
      weights.steals * numeric(row, "z_STL") +
      weights.blocks * numeric(row, "z_BLK") +
      weights.threes * numeric(row, "z_THREE_PM") +
      weights.turnovers * numeric(row, "z_TO") +
      weights.fg_pct * numeric(row, "z_FG_PCT") +
      weights.ft_pct * numeric(row, "z_FT_PCT") +
      weights.usage * numeric(row, "z_USG_PCT") +
      weights.games * numeric(row, "z_projected_games") +
      weights.minutes * numeric(row, "z_projected_minutes")
    );
  }

  function slotSalary(slotIdx, percentile, salaryCap) {
    const safeIdx = CLAMP(slotIdx, 0, SLOT_WEIGHTS.length - 1);
    const slotShare = SLOT_WEIGHTS[safeIdx];
    const marketAdj = 0.85 + 0.3 * CLAMP(percentile, 0, 1);
    return Math.round(salaryCap * slotShare * marketAdj);
  }

  function buildMiniFmv(rawRows, options) {
    const config = {
      sims: NUMBER(options.sims, DEFAULTS.sims),
      seed: NUMBER(options.seed, DEFAULTS.seed),
      salaryCap: NUMBER(options.salaryCap, DEFAULTS.salaryCap),
      teamCount: NUMBER(options.teamCount, DEFAULTS.teamCount),
      rosterSlots: NUMBER(options.rosterSlots, DEFAULTS.rosterSlots),
      noiseSigma: NUMBER(options.noiseSigma, DEFAULTS.noiseSigma),
      weights: { ...DEFAULT_WEIGHTS, ...(options.weights || {}) },
    };

    const prepared = buildPreparedRows(rawRows, config);
    const rng = mulberry32(config.seed);
    const salaryPaths = Array.from({ length: prepared.length }, () => []);
    const scorePaths = Array.from({ length: prepared.length }, () => []);

    const scoreBase = prepared.map((row) => row.weighted_score);
    const gamesFactor = prepared.map((row) => CLAMP(numeric(row, "projected_games_used", 65) / 82, 0.35, 1.15));
    const normalizedBase = scoreBase.map((score, idx) => score * gamesFactor[idx]);

    for (let sim = 0; sim < config.sims; sim += 1) {
      const simScores = normalizedBase.map((base) => base + gaussian(rng) * config.noiseSigma);
      const order = [...simScores.keys()].sort((a, b) => simScores[b] - simScores[a]);

      order.forEach((idx, rank) => {
        const slotIdx = Math.min(Math.floor(rank / config.teamCount), config.rosterSlots - 1);
        const bucketStart = slotIdx * config.teamCount;
        const bucketEnd = Math.min(bucketStart + config.teamCount, prepared.length);
        const bucketSize = Math.max(1, bucketEnd - bucketStart);
        const withinBucketRank = rank - bucketStart;
        const percentile = 1 - withinBucketRank / Math.max(bucketSize - 1, 1);
        const salary = slotSalary(slotIdx, percentile, config.salaryCap);
        salaryPaths[idx].push(salary);
        scorePaths[idx].push(simScores[idx]);
      });
    }

    const output = prepared.map((row, idx) => {
      const salaries = salaryPaths[idx];
      const scores = scorePaths[idx];
      return {
        ...row,
        sim_mean_salary: Math.round(mean(salaries)),
        sim_median_salary: Math.round(quantile(salaries, 0.5)),
        sim_p25_salary: Math.round(quantile(salaries, 0.25)),
        sim_p75_salary: Math.round(quantile(salaries, 0.75)),
        sim_salary_std: Math.round(std(salaries)),
        sim_mean_score: Number(mean(scores).toFixed(4)),
        fmv_band: bandForSalary(quantile(salaries, 0.5)),
      };
    }).sort((a, b) => numeric(b, "sim_median_salary") - numeric(a, "sim_median_salary"));

    const summary = {
      sims: config.sims,
      seed: config.seed,
      salaryCap: config.salaryCap,
      teamCount: config.teamCount,
      rosterSlots: config.rosterSlots,
      playerRows: output.length,
      topPlayer: output.length ? {
        player_name: output[0].player_name,
        team: output[0].team,
        position: output[0].position,
        sim_median_salary: output[0].sim_median_salary,
      } : {},
    };

    return { rows: output, summary };
  }

  function bandForSalary(value) {
    if (!Number.isFinite(value)) return "unknown";
    if (value <= 5000000) return "minimum";
    if (value <= 12000000) return "rotation";
    if (value <= 22000000) return "starter";
    if (value <= 35000000) return "core";
    return "star";
  }

  function buildFmvw(rawRows, options) {
    const config = {
      replacementSalary: NUMBER(options.replacementSalary, DEFAULTS.replacementSalary),
      salaryPerWin: NUMBER(options.salaryPerWin, DEFAULTS.salaryPerWin),
    };

    const rows = rawRows.map((row) => ({ ...row }));
    const salaryCol = rows[0] && "sim_median_salary" in rows[0] ? "sim_median_salary" : "median_salary";
    const lowCol = rows[0] && "sim_p25_salary" in rows[0] ? "sim_p25_salary" : "p25_salary";
    const highCol = rows[0] && "sim_p75_salary" in rows[0] ? "sim_p75_salary" : "p75_salary";

    const output = rows.map((row) => {
      const medianSalary = numeric(row, salaryCol);
      const p25Salary = numeric(row, lowCol, medianSalary);
      const p75Salary = numeric(row, highCol, medianSalary);
      return {
        ...row,
        wins_equivalent: Number(((medianSalary - config.replacementSalary) / config.salaryPerWin).toFixed(3)),
        wins_p25: Number(((p25Salary - config.replacementSalary) / config.salaryPerWin).toFixed(3)),
        wins_p75: Number(((p75Salary - config.replacementSalary) / config.salaryPerWin).toFixed(3)),
      };
    }).sort((a, b) => numeric(b, salaryCol) - numeric(a, salaryCol));

    const teamTotals = [];
    const byTeam = groupBy(output, "team");
    for (const [team, teamRows] of byTeam.entries()) {
      teamTotals.push({
        team,
        player_count: teamRows.length,
        salary_equivalent: Math.round(teamRows.reduce((sum, row) => sum + numeric(row, salaryCol), 0)),
        wins_equivalent: Number(teamRows.reduce((sum, row) => sum + numeric(row, "wins_equivalent"), 0).toFixed(3)),
      });
    }
    teamTotals.sort((a, b) => b.salary_equivalent - a.salary_equivalent);

    const summary = {
      replacementSalary: config.replacementSalary,
      salaryPerWin: config.salaryPerWin,
      playerRows: output.length,
      teamTotals,
    };

    return { rows: output, summary };
  }

  function readFileAsText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error || new Error("Unable to read file"));
      reader.readAsText(file);
    });
  }

  function parseUploadedText(text) {
    const trimmed = String(text || "").trim();
    if (!trimmed) return [];
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      const payload = JSON.parse(trimmed);
      if (Array.isArray(payload)) return payload;
      if (payload && Array.isArray(payload.players)) return payload.players;
      return [payload];
    }
    return parseCSV(trimmed);
  }

  function parseComparisonBundle(text) {
    const trimmed = String(text || "").trim();
    if (!trimmed) {
      return { player_comparisons: [], team_comparison: [] };
    }
    const payload = JSON.parse(trimmed);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return { player_comparisons: [], team_comparison: [] };
    }
    return {
      ...payload,
      player_comparisons: Array.isArray(payload.player_comparisons) ? payload.player_comparisons : [],
      team_comparison: Array.isArray(payload.team_comparison) ? payload.team_comparison : [],
    };
  }

  async function fetchRows(path) {
    const response = await fetch(path, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Failed to load ${path}`);
    }
    const text = await response.text();
    if (path.endsWith(".json")) {
      const payload = JSON.parse(text);
      if (Array.isArray(payload)) return payload;
      if (payload && Array.isArray(payload.players)) return payload.players;
      return [payload];
    }
    return parseCSV(text);
  }

  async function fetchJson(path) {
    const response = await fetch(path, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Failed to load ${path}`);
    }
    return JSON.parse(await response.text());
  }

  async function fetchComparisonBundle(path) {
    const response = await fetch(path, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Failed to load ${path}`);
    }
    const text = await response.text();
    return parseComparisonBundle(text);
  }

  function renderTable(el, rows, columns, limit = 50) {
    const view = rows.slice(0, limit);
    const headerHtml = columns.map((col) => `<th>${col.label}</th>`).join("");
    const bodyHtml = view.map((row) => {
      const cells = columns.map((col) => {
        const value = typeof col.render === "function" ? col.render(row) : row[col.key];
        return `<td>${value ?? ""}</td>`;
      }).join("");
      return `<tr>${cells}</tr>`;
    }).join("");
    el.innerHTML = `
      <table>
        <thead><tr>${headerHtml}</tr></thead>
        <tbody>${bodyHtml}</tbody>
      </table>
    `;
  }

  function setSummary(el, entries) {
    el.innerHTML = entries.map(([label, value]) => `
      <div class="metric">
        <span class="muted">${label}</span>
        <strong>${value}</strong>
      </div>
    `).join("");
  }

  function buildComparisonCsv(bundle) {
    const rows = [];
    for (const pair of bundle.player_comparisons || []) {
      rows.push({
        kind: "player",
        matchup: `${pair.left_player} vs ${pair.right_player}`,
        left_player: pair.left_player,
        right_player: pair.right_player,
        left_salary: pair.left_salary,
        right_salary: pair.right_salary,
        left_base_wins: pair.left_base_wins,
        right_base_wins: pair.right_base_wins,
        left_hbb_wins: pair.left_hbb_wins,
        right_hbb_wins: pair.right_hbb_wins,
        wins_gap_fmv_bridge: pair.wins_gap_fmv_bridge,
        wins_gap_hbb_bridge: pair.wins_gap_hbb_bridge,
      });
    }
    for (const team of bundle.team_comparison || []) {
      rows.push({
        kind: "team",
        team: team.team,
        top7_fmv_total: team.top7_fmv_total,
        top7_expected_wins_bridge: team.top7_expected_wins_bridge,
        top7_expected_wins_hbb_bridge: team.top7_expected_wins_hbb_bridge,
        team_hbb_factor: team.team_hbb_factor,
        core4_score: team.core4_score,
        support_score: team.support_score,
        core_fit_bonus: team.core_fit_bonus,
        interaction_bonus: team.interaction_bonus,
        pressure_score: team.pressure_score,
        easy_score: team.easy_score,
        pressure_bonus: team.pressure_bonus,
        easy_bonus: team.easy_bonus,
        pressure_easy_bonus: team.pressure_easy_bonus,
        depth_bonus: team.depth_bonus,
        team_total_score: team.team_total_score,
        ops_expected_wins_bridge: team.ops_expected_wins_bridge,
        ops_expected_wins_hbb_bridge: team.ops_expected_wins_hbb_bridge,
        actual_2025_26_wins: team.actual_2025_26_wins,
        top7_players_found: team.top7_players_found,
      });
    }
    return toCSV(rows, [
      "kind",
      "matchup",
      "left_player",
      "right_player",
      "left_salary",
      "right_salary",
      "left_base_wins",
      "right_base_wins",
      "left_hbb_wins",
      "right_hbb_wins",
      "wins_gap_fmv_bridge",
      "wins_gap_hbb_bridge",
      "team",
      "top7_fmv_total",
      "top7_expected_wins_bridge",
      "top7_expected_wins_hbb_bridge",
      "team_hbb_factor",
      "core4_score",
      "support_score",
      "core_fit_bonus",
      "interaction_bonus",
      "pressure_score",
      "easy_score",
      "pressure_bonus",
      "easy_bonus",
      "pressure_easy_bonus",
      "depth_bonus",
      "team_total_score",
      "ops_expected_wins_bridge",
      "ops_expected_wins_hbb_bridge",
      "actual_2025_26_wins",
      "top7_players_found",
    ]);
  }

  function downloadFile(filename, text, mime = "text/plain") {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function collectWeights(root) {
    const weights = {};
    root.querySelectorAll("[data-weight-key]").forEach((input) => {
      weights[input.dataset.weightKey] = NUMBER(input.value, DEFAULT_WEIGHTS[input.dataset.weightKey]);
    });
    return weights;
  }

  function getValue(root, selector, fallback) {
    const el = root.querySelector(selector);
    return el ? NUMBER(el.value, fallback) : fallback;
  }

  async function mountFMV(root) {
    const samplePath = root.dataset.sample || DEFAULTS.fmvFeed;
    const status = root.querySelector("[data-status]");
    const summary = root.querySelector("[data-summary]");
    const table = root.querySelector("[data-table]");
    const fileInput = root.querySelector("[data-file-input]");
    const loadDemoBtn = root.querySelector("[data-load-demo]");
    const runBtn = root.querySelector("[data-run]");
    const downloadCsvBtn = root.querySelector("[data-download-csv]");
    const downloadJsonBtn = root.querySelector("[data-download-json]");
    const viewLimit = root.querySelector("[data-view-limit]");

    let currentRows = [];
    let currentResult = null;

    const render = () => {
      if (!currentResult) return;
      const columns = [
        { key: "player_name", label: "Player" },
        { key: "team", label: "Team" },
        { key: "position", label: "Pos" },
        { key: "sim_median_salary", label: "Median", render: (row) => formatCurrency(numeric(row, "sim_median_salary")) },
        { key: "sim_p25_salary", label: "P25", render: (row) => formatCurrency(numeric(row, "sim_p25_salary")) },
        { key: "sim_p75_salary", label: "P75", render: (row) => formatCurrency(numeric(row, "sim_p75_salary")) },
        { key: "weighted_score", label: "Weighted Score", render: (row) => formatFloat(numeric(row, "weighted_score"), 3) },
        { key: "fmv_band", label: "Band" },
      ];
      renderTable(table, currentResult.rows, columns, NUMBER(viewLimit.value, 50));
      setSummary(summary, [
        ["Players", currentResult.summary.playerRows],
        ["Sim Count", currentResult.summary.sims],
        ["Cap", formatCurrency(currentResult.summary.salaryCap)],
        ["Top Player", currentResult.summary.topPlayer.player_name || "--"],
      ]);
      downloadCsvBtn.disabled = false;
      downloadJsonBtn.disabled = false;
    };

    const run = () => {
      if (!currentRows.length) {
        status.textContent = "Load a feed first.";
        return;
      }
      status.textContent = "Running FMV simulation...";
      currentResult = buildMiniFmv(currentRows, {
        sims: getValue(root, "[data-sims]", DEFAULTS.sims),
        seed: getValue(root, "[data-seed]", DEFAULTS.seed),
        salaryCap: getValue(root, "[data-salary-cap]", DEFAULTS.salaryCap),
        teamCount: getValue(root, "[data-team-count]", DEFAULTS.teamCount),
        rosterSlots: getValue(root, "[data-roster-slots]", DEFAULTS.rosterSlots),
        noiseSigma: getValue(root, "[data-noise-sigma]", DEFAULTS.noiseSigma),
        weights: collectWeights(root),
      });
      status.textContent = `Built ${currentResult.summary.playerRows} player rows.`;
      render();
    };

    const loadDemo = async () => {
      status.textContent = "Loading demo feed...";
      currentRows = await fetchRows(samplePath);
      status.textContent = `Loaded ${currentRows.length} rows from demo feed.`;
      run();
    };

    fileInput.addEventListener("change", async () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;
      status.textContent = `Reading ${file.name}...`;
      const text = await readFileAsText(file);
      currentRows = parseUploadedText(text);
      status.textContent = `Loaded ${currentRows.length} rows from ${file.name}.`;
      run();
    });

    loadDemoBtn.addEventListener("click", loadDemo);
    runBtn.addEventListener("click", run);
    downloadCsvBtn.addEventListener("click", () => {
      if (!currentResult) return;
      const csv = toCSV(currentResult.rows);
      downloadFile("fmv_output.csv", csv, "text/csv");
    });
    downloadJsonBtn.addEventListener("click", () => {
      if (!currentResult) return;
      downloadFile("fmv_output.json", JSON.stringify(currentResult, null, 2) + "\n", "application/json");
    });
    viewLimit.addEventListener("change", render);

    await loadDemo();
  }

  function normalizeText(value) {
    return String(value || "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();
  }

  function buildHbbLookup(bundle) {
    const lookup = {};
    for (const row of Array.isArray(bundle?.rows) ? bundle.rows : []) {
      const team = String(row.team || "").trim().toUpperCase();
      if (team) lookup[team] = NUMBER(row.team_hbb_factor, 1.0);
    }
    return lookup;
  }

  function proxySignal(score) {
    if (!Number.isFinite(score)) return "INSUFFICIENT_BASELINE";
    if (score >= 1.0) return "SIGNIFICANTLY_ABOVE_BASELINE";
    if (score >= 0.35) return "ABOVE_BASELINE";
    if (score <= -1.0) return "SIGNIFICANTLY_BELOW_BASELINE";
    if (score <= -0.35) return "BELOW_BASELINE";
    return "ON_BASELINE";
  }

  function buildProxyLookup(rows) {
    const prepared = (Array.isArray(rows) ? rows : []).map((row) => ({
      player_name: String(row.player_name || row.player || row.name || "").trim(),
      position: String(row.position || "ALL").trim().toUpperCase() || "ALL",
      source: row.projection || row,
      offense_raw:
        OFFENSE_PROXY_WEIGHTS.points * numeric(row.projection || row, "points") +
        OFFENSE_PROXY_WEIGHTS.assists * numeric(row.projection || row, "assists") +
        OFFENSE_PROXY_WEIGHTS.tpm * numeric(row.projection || row, "three_pt_pct") +
        OFFENSE_PROXY_WEIGHTS.fg_pct * numeric(row.projection || row, "fg_pct") +
        OFFENSE_PROXY_WEIGHTS.ft_pct * numeric(row.projection || row, "ft_pct") +
        OFFENSE_PROXY_WEIGHTS.turnovers * numeric(row.projection || row, "turnovers"),
      defense_raw:
        DEFENSE_PROXY_WEIGHTS.rebounds * numeric(row.projection || row, "rebounds") +
        DEFENSE_PROXY_WEIGHTS.steals * numeric(row.projection || row, "steals") +
        DEFENSE_PROXY_WEIGHTS.blocks * numeric(row.projection || row, "blocks") +
        DEFENSE_PROXY_WEIGHTS.turnovers * numeric(row.projection || row, "turnovers"),
    }));
    const groups = groupBy(prepared, "position");
    for (const [, members] of groups.entries()) {
      const offenseMean = mean(members.map((row) => row.offense_raw));
      const offenseStd = std(members.map((row) => row.offense_raw));
      const defenseMean = mean(members.map((row) => row.defense_raw));
      const defenseStd = std(members.map((row) => row.defense_raw));
      members.forEach((row) => {
        row.offense_proxy_z = zScore(row.offense_raw, offenseMean, offenseStd);
        row.defense_proxy_z = zScore(row.defense_raw, defenseMean, defenseStd);
        row.offense_proxy_signal = proxySignal(row.offense_proxy_z);
        row.defense_proxy_signal = proxySignal(row.defense_proxy_z);
      });
    }
    return new Map(prepared.map((row) => [normalizeText(row.player_name), row]));
  }

  async function mountFMVW(root) {
    const samplePath = root.dataset.sample || DEFAULTS.fmvFeed;
    const projectionPath = root.dataset.projection || DEFAULTS.fmvwProjectionFeed;
    const leaguePath = root.dataset.league || DEFAULTS.leagueTableFeed;
    const status = root.querySelector("[data-status]");
    const summary = root.querySelector("[data-summary]");
    const gapSummary = root.querySelector("[data-gap-summary]");
    const projectionSummary = root.querySelector("[data-projection-summary]");
    const projectionTable = root.querySelector("[data-projection-table]");
    const table = root.querySelector("[data-table]");
    const compareHeadline = root.querySelector("[data-compare-headline]");
    const proxyCallout = root.querySelector("[data-proxy-callout]");
    const compareBtn = root.querySelector("[data-compare]");
    const playerAInput = root.querySelector("[data-player-a]");
    const playerBInput = root.querySelector("[data-player-b]");

    let currentRows = [];
    let leagueBundle = {};
    let projectionBundle = {};
    let currentResult = null;

    const populatePlayerSelects = (rows) => {
      const sorted = [...rows].sort((a, b) => String(a.player_name || "").localeCompare(String(b.player_name || "")));
      const defaultA = sorted.find((row) => normalizeText(row.player_name) === normalizeText("Nikola Jokić"))?.player_name || sorted[0]?.player_name || "";
      const defaultB = sorted.find((row) => normalizeText(row.player_name) === normalizeText("Rudy Gobert"))?.player_name || sorted[1]?.player_name || sorted[0]?.player_name || "";
      for (const select of [playerAInput, playerBInput]) {
        if (!select) continue;
        const previous = String(select.value || "");
        select.innerHTML = [
          `<option value="">Select a player</option>`,
          ...sorted.map((row) => `<option value="${escapeHTML(row.player_name)}">${escapeHTML(row.player_name)}</option>`),
        ].join("");
        if (previous && sorted.some((row) => row.player_name === previous)) {
          select.value = previous;
        }
      }
      if (playerAInput && !playerAInput.value) playerAInput.value = defaultA;
      if (playerBInput && !playerBInput.value) playerBInput.value = defaultB;
    };

    const render = () => {
      if (!currentResult) return;
      const columns = [
        { key: "slot", label: "Slot" },
        { key: "player_name", label: "Player" },
        { key: "team", label: "Team" },
        { key: "position", label: "Pos" },
        { key: "sim_median_salary", label: "FMV", render: (row) => formatCurrency(numeric(row, "sim_median_salary")) },
        { key: "wins_equivalent", label: "Wins Eq", render: (row) => formatFloat(numeric(row, "wins_equivalent"), 3) },
        { key: "hbb_factor", label: "HBB", render: (row) => formatFloat(numeric(row, "hbb_factor"), 3) },
        { key: "hbb_wins", label: "HBB Wins", render: (row) => formatFloat(numeric(row, "hbb_wins"), 3) },
        { key: "proxy_adjusted_wins", label: "Proxy Wins", render: (row) => formatFloat(numeric(row, "proxy_adjusted_wins"), 3) },
        { key: "offense_proxy_z", label: "Off Proxy", render: (row) => formatFloat(numeric(row, "offense_proxy_z"), 3) },
        { key: "defense_proxy_z", label: "Def Proxy", render: (row) => formatFloat(numeric(row, "defense_proxy_z"), 3) },
        { key: "fmv_band", label: "Band" },
      ];
      renderTable(table, currentResult.rows, columns, 2);
      setSummary(summary, [
        ["Left", `${currentResult.left.player_name} (${currentResult.left.team})`],
        ["Right", `${currentResult.right.player_name} (${currentResult.right.team})`],
        ["Base Gap", formatFloat(currentResult.gap.wins_gap_fmv_bridge, 3)],
        ["HBB Gap", formatFloat(currentResult.gap.wins_gap_hbb_bridge, 3)],
      ]);
      setSummary(gapSummary, [
        ["Left FMV", formatCurrency(numeric(currentResult.left, "sim_median_salary"))],
        ["Right FMV", formatCurrency(numeric(currentResult.right, "sim_median_salary"))],
        ["Left Wins", formatFloat(currentResult.left.wins_equivalent, 3)],
        ["Right Wins", formatFloat(currentResult.right.wins_equivalent, 3)],
        ["Left HBB", formatFloat(currentResult.left_hbb_factor, 3)],
        ["Right HBB", formatFloat(currentResult.right_hbb_factor, 3)],
        ["Left HBB Wins", formatFloat(currentResult.left_hbb_wins, 3)],
        ["Right HBB Wins", formatFloat(currentResult.right_hbb_wins, 3)],
        ["Left Proxy Wins", formatFloat(currentResult.left.proxy_adjusted_wins, 3)],
        ["Right Proxy Wins", formatFloat(currentResult.right.proxy_adjusted_wins, 3)],
        ["Left Off Proxy", formatFloat(currentResult.left.offense_proxy_z, 3)],
        ["Left Def Proxy", formatFloat(currentResult.left.defense_proxy_z, 3)],
        ["Right Off Proxy", formatFloat(currentResult.right.offense_proxy_z, 3)],
        ["Right Def Proxy", formatFloat(currentResult.right.defense_proxy_z, 3)],
      ]);
      if (compareHeadline) {
        const gap = Number(currentResult.gap.wins_gap_proxy_adjusted || 0);
        const betterWorse = gap >= 0 ? "better than" : "worse than";
        compareHeadline.textContent = `Under the current FMVW bridge, HBB adjustment, and proxy weighting, ${currentResult.left.player_name} is ${Math.abs(gap).toFixed(3)} proxy-adjusted wins ${betterWorse} ${currentResult.right.player_name}.`;
      }
      if (proxyCallout) {
        proxyCallout.textContent = `Proxy read: ${currentResult.left.player_name} off ${formatFloat(currentResult.left.offense_proxy_z, 3)}, def ${formatFloat(currentResult.left.defense_proxy_z, 3)} | ${currentResult.right.player_name} off ${formatFloat(currentResult.right.offense_proxy_z, 3)}, def ${formatFloat(currentResult.right.defense_proxy_z, 3)}. These proxy scores now feed the proxy-adjusted wins number below.`;
      }

      const projRows = Array.isArray(projectionBundle.rows) ? projectionBundle.rows : [];
      const selectedProjectionRows = [
        currentResult.left,
        currentResult.right,
      ].map((side) => {
        const projectionRow = projRows.find((row) => normalizeText(row.player_name) === normalizeText(side.player_name));
        return projectionRow ? { side: side.slot, ...projectionRow } : null;
      }).filter(Boolean);
      if (projectionSummary) {
        const leftProj = selectedProjectionRows.find((row) => row.side === "A");
        const rightProj = selectedProjectionRows.find((row) => row.side === "B");
        projectionSummary.textContent = leftProj && rightProj
          ? `${projectionBundle.title || "DBB2 Teammate-Neutral Projection 26-27"} loaded for the selected players.`
          : "Projection feed loaded.";
      }
      if (projectionTable) {
        renderTable(
          projectionTable,
          selectedProjectionRows,
          [
            { key: "player_name", label: "Player" },
            { key: "team", label: "Team" },
            { key: "position", label: "Pos" },
            { key: "projection.minutes", label: "MP", render: (row) => formatFloat(row.projection?.minutes, 1) },
            { key: "projection.points", label: "PTS", render: (row) => formatFloat(row.projection?.points, 1) },
            { key: "projection.rebounds", label: "REB", render: (row) => formatFloat(row.projection?.rebounds, 1) },
            { key: "projection.assists", label: "AST", render: (row) => formatFloat(row.projection?.assists, 1) },
            { key: "projection.steals", label: "STL", render: (row) => formatFloat(row.projection?.steals, 1) },
            { key: "projection.blocks", label: "BLK", render: (row) => formatFloat(row.projection?.blocks, 1) },
            { key: "projection.fantasy_points", label: "FP", render: (row) => formatFloat(row.projection?.fantasy_points, 1) },
            { key: "sim_median_salary", label: "FMV", render: (row) => formatCurrency(numeric(row, "sim_median_salary")) },
          ],
          2
        );
      }
    };

    const run = () => {
      if (!currentRows.length) {
        status.textContent = "Load a player pool first.";
        return;
      }
      const leftName = String(playerAInput?.value || "").trim();
      const rightName = String(playerBInput?.value || "").trim();
      const leftRow = currentRows.find((row) => normalizeText(row.player_name) === normalizeText(leftName));
      const rightRow = currentRows.find((row) => normalizeText(row.player_name) === normalizeText(rightName));
      if (!leftRow || !rightRow) {
        status.textContent = "Select two players from the loaded pool.";
        return;
      }

      const ranked = buildFmvw([leftRow, rightRow], {
        replacementSalary: DEFAULTS.replacementSalary,
        salaryPerWin: DEFAULTS.salaryPerWin,
      }).rows;
      const byName = new Map(ranked.map((row) => [normalizeText(row.player_name), row]));
      const hbbLookup = buildHbbLookup(leagueBundle);
      const left = byName.get(normalizeText(leftName));
      const right = byName.get(normalizeText(rightName));
      const leftHbbFactor = NUMBER(hbbLookup[String(left.team || "").trim().toUpperCase()], 1.0);
      const rightHbbFactor = NUMBER(hbbLookup[String(right.team || "").trim().toUpperCase()], 1.0);
      const leftHbbWins = Number((left.wins_equivalent * leftHbbFactor).toFixed(3));
      const rightHbbWins = Number((right.wins_equivalent * rightHbbFactor).toFixed(3));

      const proxyLookup = buildProxyLookup(projectionBundle.rows || currentRows);
      const leftProxy = proxyLookup.get(normalizeText(left.player_name)) || {};
      const rightProxy = proxyLookup.get(normalizeText(right.player_name)) || {};
      const leftProxyAdjustment = Number(((leftProxy.offense_proxy_z || 0) * PROXY_WINS_WEIGHTS.offense + (leftProxy.defense_proxy_z || 0) * PROXY_WINS_WEIGHTS.defense).toFixed(3));
      const rightProxyAdjustment = Number(((rightProxy.offense_proxy_z || 0) * PROXY_WINS_WEIGHTS.offense + (rightProxy.defense_proxy_z || 0) * PROXY_WINS_WEIGHTS.defense).toFixed(3));
      const leftProxyWins = Number((leftHbbWins + leftProxyAdjustment).toFixed(3));
      const rightProxyWins = Number((rightHbbWins + rightProxyAdjustment).toFixed(3));

      currentResult = {
        left: { ...left, ...leftProxy, proxy_adjusted_wins: leftProxyWins },
        right: { ...right, ...rightProxy, proxy_adjusted_wins: rightProxyWins },
        left_hbb_factor: leftHbbFactor,
        right_hbb_factor: rightHbbFactor,
        left_hbb_wins: leftHbbWins,
        right_hbb_wins: rightHbbWins,
        left_proxy_adjustment: leftProxyAdjustment,
        right_proxy_adjustment: rightProxyAdjustment,
        left_proxy_wins: leftProxyWins,
        right_proxy_wins: rightProxyWins,
        gap: {
          salary_gap: Number((left.sim_median_salary - right.sim_median_salary).toFixed(2)),
          wins_gap_fmv_bridge: Number((left.wins_equivalent - right.wins_equivalent).toFixed(3)),
          wins_gap_hbb_bridge: Number((leftHbbWins - rightHbbWins).toFixed(3)),
          wins_gap_proxy_adjusted: Number((leftProxyWins - rightProxyWins).toFixed(3)),
        },
        rows: [
          { slot: "A", ...left, ...leftProxy, hbb_factor: leftHbbFactor, hbb_wins: leftHbbWins, proxy_adjusted_wins: leftProxyWins },
          { slot: "B", ...right, ...rightProxy, hbb_factor: rightHbbFactor, hbb_wins: rightHbbWins, proxy_adjusted_wins: rightProxyWins },
        ],
      };
      status.textContent = "Comparison ready.";
      render();
    };

    const loadPool = async () => {
      status.textContent = "Loading 25-26 top 200 pool...";
      const [pool, league, projection] = await Promise.all([
        fetchRows(samplePath),
        fetchJson(leaguePath),
        fetchJson(projectionPath),
      ]);
      currentRows = pool;
      leagueBundle = league;
      projectionBundle = projection;
      populatePlayerSelects(currentRows);
      status.textContent = `Loaded ${currentRows.length} players from the 25-26 top 200 pool.`;
      run();
    };

    compareBtn.addEventListener("click", run);
    playerAInput?.addEventListener("change", run);
    playerBInput?.addEventListener("change", run);

    await loadPool();
  }

  async function mountTeam(root) {
    const samplePath = root.dataset.sample || DEFAULTS.teamComparisonFeed;
    const status = root.querySelector("[data-status]");
    const summary = root.querySelector("[data-summary]");
    const teamTable = root.querySelector("[data-team-table]");
    const playerTable = root.querySelector("[data-player-table]");
    const fileInput = root.querySelector("[data-file-input]");
    const loadDemoBtn = root.querySelector("[data-load-demo]");
    const runBtn = root.querySelector("[data-run]");
    const downloadCsvBtn = root.querySelector("[data-download-csv]");
    const downloadJsonBtn = root.querySelector("[data-download-json]");
    const viewLimit = root.querySelector("[data-view-limit]");

    let currentBundle = { player_comparisons: [], team_comparison: [] };

    const render = () => {
      const teamColumns = [
        { key: "team", label: "Team" },
        { key: "top7_fmv_total", label: "Top 7 FMV", render: (row) => formatCurrency(numeric(row, "top7_fmv_total")) },
        { key: "top7_expected_wins_bridge", label: "FMVW", render: (row) => formatFloat(numeric(row, "top7_expected_wins_bridge"), 3) },
        { key: "team_hbb_factor", label: "HBB", render: (row) => formatFloat(numeric(row, "team_hbb_factor"), 3) },
        { key: "top7_expected_wins_hbb_bridge", label: "FMVW + HBB", render: (row) => formatFloat(numeric(row, "top7_expected_wins_hbb_bridge"), 3) },
        { key: "core4_score", label: "Core 4", render: (row) => formatFloat(numeric(row, "core4_score"), 3) },
        { key: "support_score", label: "Support", render: (row) => formatFloat(numeric(row, "support_score"), 3) },
        { key: "core_fit_bonus", label: "Fit", render: (row) => formatFloat(numeric(row, "core_fit_bonus"), 3) },
        { key: "interaction_bonus", label: "Interaction", render: (row) => formatFloat(numeric(row, "interaction_bonus"), 3) },
        { key: "pressure_score", label: "Pressure", render: (row) => formatFloat(numeric(row, "pressure_score"), 3) },
        { key: "easy_score", label: "Easy", render: (row) => formatFloat(numeric(row, "easy_score"), 3) },
        { key: "pressure_bonus", label: "P Bonus", render: (row) => formatFloat(numeric(row, "pressure_bonus"), 3) },
        { key: "easy_bonus", label: "E Bonus", render: (row) => formatFloat(numeric(row, "easy_bonus"), 3) },
        { key: "pressure_easy_bonus", label: "P/E", render: (row) => formatFloat(numeric(row, "pressure_easy_bonus"), 3) },
        { key: "depth_bonus", label: "Depth", render: (row) => formatFloat(numeric(row, "depth_bonus"), 3) },
        { key: "team_total_score", label: "Team Score", render: (row) => formatFloat(numeric(row, "team_total_score"), 3) },
        { key: "ops_expected_wins_bridge", label: "Team Wins", render: (row) => formatFloat(numeric(row, "ops_expected_wins_bridge"), 3) },
        { key: "ops_expected_wins_hbb_bridge", label: "Team + HBB", render: (row) => formatFloat(numeric(row, "ops_expected_wins_hbb_bridge"), 3) },
        { key: "actual_2025_26_wins", label: "Actual Wins", render: (row) => row.actual_2025_26_wins ?? "--" },
        { key: "top7_players_found", label: "Top 7 Found" },
        { key: "top7_players_missing", label: "Missing", render: (row) => (row.top7_players_missing || []).join(" | ") || "--" },
      ];
      const playerColumns = [
        { key: "matchup", label: "Matchup", render: (row) => `${row.left_player} vs ${row.right_player}` },
        { key: "left_salary", label: "Left FMV", render: (row) => formatCurrency(numeric(row, "left_salary")) },
        { key: "right_salary", label: "Right FMV", render: (row) => formatCurrency(numeric(row, "right_salary")) },
        { key: "left_base_wins", label: "Left Wins", render: (row) => formatFloat(numeric(row, "left_base_wins"), 3) },
        { key: "right_base_wins", label: "Right Wins", render: (row) => formatFloat(numeric(row, "right_base_wins"), 3) },
        { key: "left_hbb_wins", label: "Left HBB", render: (row) => formatFloat(numeric(row, "left_hbb_wins"), 3) },
        { key: "right_hbb_wins", label: "Right HBB", render: (row) => formatFloat(numeric(row, "right_hbb_wins"), 3) },
        { key: "wins_gap_fmv_bridge", label: "Base Gap", render: (row) => formatFloat(numeric(row, "wins_gap_fmv_bridge"), 3) },
        { key: "wins_gap_hbb_bridge", label: "HBB Gap", render: (row) => formatFloat(numeric(row, "wins_gap_hbb_bridge"), 3) },
      ];

      if (teamTable) {
        renderTable(teamTable, currentBundle.team_comparison || [], teamColumns, NUMBER(viewLimit.value, 20));
      }
      if (playerTable) {
        renderTable(playerTable, currentBundle.player_comparisons || [], playerColumns, NUMBER(viewLimit.value, 20));
      }
      setSummary(summary, [
        ["Teams", currentBundle.team_comparison?.length || 0],
        ["Player Matchups", currentBundle.player_comparisons?.length || 0],
        ["League HBB", formatFloat(numeric(currentBundle, "league_hbb"), 3)],
        ["FMVW R^2", formatFloat(numeric(currentBundle?.fmvw_backtest?.curve || {}, "r2"), 3)],
      ]);
      downloadCsvBtn.disabled = false;
      downloadJsonBtn.disabled = false;
    };

    const run = () => {
      if (!currentBundle.team_comparison.length && !currentBundle.player_comparisons.length) {
        status.textContent = "Load a team comparison bundle first.";
        return;
      }
      status.textContent = "Rendering team comparison...";
      render();
      status.textContent = "Team comparison ready.";
    };

    const loadDemo = async () => {
      status.textContent = "Loading demo team comparison...";
      currentBundle = await fetchComparisonBundle(samplePath);
      status.textContent = "Loaded demo team comparison bundle.";
      run();
    };

    fileInput.addEventListener("change", async () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;
      status.textContent = `Reading ${file.name}...`;
      const text = await readFileAsText(file);
      currentBundle = parseComparisonBundle(text);
      status.textContent = `Loaded team comparison bundle from ${file.name}.`;
      run();
    });

    loadDemoBtn.addEventListener("click", loadDemo);
    runBtn.addEventListener("click", run);
    downloadCsvBtn.addEventListener("click", () => {
      if (!currentBundle) return;
      downloadFile("team_comparison_output.csv", buildComparisonCsv(currentBundle), "text/csv");
    });
    downloadJsonBtn.addEventListener("click", () => {
      if (!currentBundle) return;
      downloadFile("team_comparison_output.json", JSON.stringify(currentBundle, null, 2) + "\n", "application/json");
    });
    viewLimit.addEventListener("change", render);

    await loadDemo();
  }

  async function mountProcess(root) {
    const summary = root.querySelector("[data-summary]");
    setSummary(summary, [
      ["1. Raw DBB2", "Projection engine"],
      ["2. Neutralize", "Teammate-neutral feed"],
      ["3. Price", "FMV market value"],
      ["4. Bridge", "FMVW and team value"],
    ]);
  }

  async function mountLeague(root) {
    const samplePath = root.dataset.sample || DEFAULTS.leagueTableFeed;
    const status = root.querySelector("[data-status]");
    const summary = root.querySelector("[data-summary]");
    const table = root.querySelector("[data-table]");
    const fileInput = root.querySelector("[data-file-input]");
    const loadDemoBtn = root.querySelector("[data-load-demo]");
    const runBtn = root.querySelector("[data-run]");
    const downloadCsvBtn = root.querySelector("[data-download-csv]");
    const downloadJsonBtn = root.querySelector("[data-download-json]");
    const viewLimit = root.querySelector("[data-view-limit]");

    let currentBundle = {};

    const rows = () => Array.isArray(currentBundle.rows) ? currentBundle.rows : [];
    const csvRows = () => rows().map((row) => ({
      team: row.team,
      actual_2025_26_wins: row.actual_2025_26_wins,
      top7_fmv_total: row.top7_fmv_total,
      top7_expected_wins_bridge: row.top7_expected_wins_bridge,
      top7_expected_wins_hbb_bridge: row.top7_expected_wins_hbb_bridge,
      core4_score: row.core4_score,
      support_score: row.support_score,
      core_fit_bonus: row.core_fit_bonus,
      interaction_bonus: row.interaction_bonus,
      pressure_bonus: row.pressure_bonus,
      easy_bonus: row.easy_bonus,
      pressure_easy_bonus: row.pressure_easy_bonus,
      depth_bonus: row.depth_bonus,
      team_total_score: row.team_total_score,
      ops_expected_wins_bridge: row.ops_expected_wins_bridge,
      ops_expected_wins_hbb_bridge: row.ops_expected_wins_hbb_bridge,
    }));

    const render = () => {
      const columns = [
        { key: "team", label: "Team" },
        { key: "actual_2025_26_wins", label: "Actual", render: (row) => row.actual_2025_26_wins ?? "--" },
        { key: "top7_fmv_total", label: "Top 7 FMV", render: (row) => formatCurrency(numeric(row, "top7_fmv_total")) },
        { key: "top7_expected_wins_bridge", label: "FMVW", render: (row) => formatFloat(numeric(row, "top7_expected_wins_bridge"), 3) },
        { key: "top7_expected_wins_hbb_bridge", label: "FMVW + HBB", render: (row) => formatFloat(numeric(row, "top7_expected_wins_hbb_bridge"), 3) },
        { key: "core4_score", label: "Core 4", render: (row) => formatFloat(numeric(row, "core4_score"), 3) },
        { key: "support_score", label: "Support", render: (row) => formatFloat(numeric(row, "support_score"), 3) },
        { key: "core_fit_bonus", label: "Fit", render: (row) => formatFloat(numeric(row, "core_fit_bonus"), 3) },
        { key: "interaction_bonus", label: "Interaction", render: (row) => formatFloat(numeric(row, "interaction_bonus"), 3) },
        { key: "pressure_bonus", label: "P Bonus", render: (row) => formatFloat(numeric(row, "pressure_bonus"), 3) },
        { key: "easy_bonus", label: "E Bonus", render: (row) => formatFloat(numeric(row, "easy_bonus"), 3) },
        { key: "pressure_easy_bonus", label: "P/E", render: (row) => formatFloat(numeric(row, "pressure_easy_bonus"), 3) },
        { key: "depth_bonus", label: "Depth", render: (row) => formatFloat(numeric(row, "depth_bonus"), 3) },
        { key: "team_total_score", label: "Team Score", render: (row) => formatFloat(numeric(row, "team_total_score"), 3) },
        { key: "ops_expected_wins_bridge", label: "Team Wins", render: (row) => formatFloat(numeric(row, "ops_expected_wins_bridge"), 3) },
        { key: "ops_expected_wins_hbb_bridge", label: "Team + HBB", render: (row) => formatFloat(numeric(row, "ops_expected_wins_hbb_bridge"), 3) },
      ];
      renderTable(table, rows(), columns, NUMBER(viewLimit.value, 30));
      setSummary(summary, [
        ["Teams", rows().length],
        ["League HBB", formatFloat(numeric(currentBundle, "league_hbb"), 3)],
        ["Backtest R^2", formatFloat(numeric(currentBundle.fmvw_backtest?.curve || {}, "r2"), 3)],
        ["Backtest MAE", formatFloat(numeric(currentBundle.fmvw_backtest?.curve || {}, "mae"), 3)],
      ]);
      downloadCsvBtn.disabled = false;
      downloadJsonBtn.disabled = false;
    };

    const run = () => {
      if (!rows().length) {
        status.textContent = "Load a league table bundle first.";
        return;
      }
      status.textContent = "Rendering league table...";
      render();
      status.textContent = "League table ready.";
    };

    const loadDemo = async () => {
      status.textContent = "Loading demo league table...";
      currentBundle = await fetchComparisonBundle(samplePath);
      status.textContent = "Loaded demo league table bundle.";
      run();
    };

    fileInput.addEventListener("change", async () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;
      status.textContent = `Reading ${file.name}...`;
      const text = await readFileAsText(file);
      currentBundle = parseComparisonBundle(text);
      status.textContent = `Loaded league table bundle from ${file.name}.`;
      run();
    });

    loadDemoBtn.addEventListener("click", loadDemo);
    runBtn.addEventListener("click", run);
    downloadCsvBtn.addEventListener("click", () => {
      if (!currentBundle) return;
      downloadFile("league_table_output.csv", toCSV(csvRows()), "text/csv");
    });
    downloadJsonBtn.addEventListener("click", () => {
      if (!currentBundle) return;
      downloadFile("league_table_output.json", JSON.stringify(currentBundle, null, 2) + "\n", "application/json");
    });
    viewLimit.addEventListener("change", render);

    await loadDemo();
  }

  async function mountHub(root) {
    const summary = root.querySelector("[data-summary]");
    const loadDemo = async () => {
      try {
        const demo = await fetchRows(DEFAULTS.fmvFeed);
        setSummary(summary, [
          ["Demo Players", demo.length],
          ["Pages", "FMV / FMVW / Team / Process"],
          ["Mode", "Backendless"],
        ]);
      } catch (_err) {
        setSummary(summary, [
          ["Demo Players", "--"],
          ["Pages", "FMV / FMVW / Team / Process"],
          ["Mode", "Backendless"],
        ]);
      }
    };
    await loadDemo();
  }

  async function init() {
    const app = document.body.dataset.app;
    const root = document.querySelector("[data-app-root]");
    if (!app || !root) return;
    if (app === "hub") await mountHub(root);
    if (app === "fmv") await mountFMV(root);
    if (app === "fmvw") await mountFMVW(root);
    if (app === "team") await mountTeam(root);
    if (app === "process") await mountProcess(root);
    if (app === "league") await mountLeague(root);
  }

  window.BasketballOpsApp = {
    parseCSV,
    toCSV,
    buildMiniFmv,
    buildFmvw,
  };

  document.addEventListener("DOMContentLoaded", init);
})();
