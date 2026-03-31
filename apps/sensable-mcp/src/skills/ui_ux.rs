use std::io::Cursor;

// --- Embedded CSV data (compiled into the binary) ---

const STYLES_CSV: &str = include_str!("../../data/ui-ux-pro-max/styles.csv");
const COLORS_CSV: &str = include_str!("../../data/ui-ux-pro-max/colors.csv");
const TYPOGRAPHY_CSV: &str = include_str!("../../data/ui-ux-pro-max/typography.csv");
const UX_GUIDELINES_CSV: &str = include_str!("../../data/ui-ux-pro-max/ux-guidelines.csv");
const PRODUCTS_CSV: &str = include_str!("../../data/ui-ux-pro-max/products.csv");
const CHARTS_CSV: &str = include_str!("../../data/ui-ux-pro-max/charts.csv");
const LANDING_CSV: &str = include_str!("../../data/ui-ux-pro-max/landing.csv");
const UI_REASONING_CSV: &str = include_str!("../../data/ui-ux-pro-max/ui-reasoning.csv");
const ICONS_CSV: &str = include_str!("../../data/ui-ux-pro-max/icons.csv");

// Stack CSVs
const STACK_REACT_CSV: &str = include_str!("../../data/ui-ux-pro-max/stacks/react.csv");
const STACK_NEXTJS_CSV: &str = include_str!("../../data/ui-ux-pro-max/stacks/nextjs.csv");
const STACK_VUE_CSV: &str = include_str!("../../data/ui-ux-pro-max/stacks/vue.csv");
const STACK_SVELTE_CSV: &str = include_str!("../../data/ui-ux-pro-max/stacks/svelte.csv");
const STACK_ANGULAR_CSV: &str = include_str!("../../data/ui-ux-pro-max/stacks/angular.csv");
const STACK_FLUTTER_CSV: &str = include_str!("../../data/ui-ux-pro-max/stacks/flutter.csv");
const STACK_REACT_NATIVE_CSV: &str = include_str!("../../data/ui-ux-pro-max/stacks/react-native.csv");
const STACK_SWIFTUI_CSV: &str = include_str!("../../data/ui-ux-pro-max/stacks/swiftui.csv");
const STACK_SHADCN_CSV: &str = include_str!("../../data/ui-ux-pro-max/stacks/shadcn.csv");
const STACK_HTML_TAILWIND_CSV: &str = include_str!("../../data/ui-ux-pro-max/stacks/html-tailwind.csv");
const STACK_ASTRO_CSV: &str = include_str!("../../data/ui-ux-pro-max/stacks/astro.csv");
const STACK_NUXTJS_CSV: &str = include_str!("../../data/ui-ux-pro-max/stacks/nuxtjs.csv");
const STACK_NUXT_UI_CSV: &str = include_str!("../../data/ui-ux-pro-max/stacks/nuxt-ui.csv");
const STACK_LARAVEL_CSV: &str = include_str!("../../data/ui-ux-pro-max/stacks/laravel.csv");
const STACK_THREEJS_CSV: &str = include_str!("../../data/ui-ux-pro-max/stacks/threejs.csv");
const STACK_JETPACK_COMPOSE_CSV: &str =
    include_str!("../../data/ui-ux-pro-max/stacks/jetpack-compose.csv");

/// Resolve domain name to its CSV data.
fn domain_csv(domain: &str) -> Option<&'static str> {
    match domain {
        "style" | "styles" => Some(STYLES_CSV),
        "color" | "colors" => Some(COLORS_CSV),
        "typography" | "font" | "fonts" => Some(TYPOGRAPHY_CSV),
        "ux" | "ux-guidelines" => Some(UX_GUIDELINES_CSV),
        "product" | "products" => Some(PRODUCTS_CSV),
        "chart" | "charts" => Some(CHARTS_CSV),
        "landing" => Some(LANDING_CSV),
        "reasoning" | "ui-reasoning" => Some(UI_REASONING_CSV),
        "icon" | "icons" => Some(ICONS_CSV),
        _ => None,
    }
}

/// Resolve stack name to its CSV data.
fn stack_csv(stack: &str) -> Option<&'static str> {
    match stack {
        "react" => Some(STACK_REACT_CSV),
        "nextjs" | "next" => Some(STACK_NEXTJS_CSV),
        "vue" => Some(STACK_VUE_CSV),
        "svelte" => Some(STACK_SVELTE_CSV),
        "angular" => Some(STACK_ANGULAR_CSV),
        "flutter" => Some(STACK_FLUTTER_CSV),
        "react-native" => Some(STACK_REACT_NATIVE_CSV),
        "swiftui" => Some(STACK_SWIFTUI_CSV),
        "shadcn" => Some(STACK_SHADCN_CSV),
        "html-tailwind" | "tailwind" => Some(STACK_HTML_TAILWIND_CSV),
        "astro" => Some(STACK_ASTRO_CSV),
        "nuxtjs" | "nuxt" => Some(STACK_NUXTJS_CSV),
        "nuxt-ui" => Some(STACK_NUXT_UI_CSV),
        "laravel" => Some(STACK_LARAVEL_CSV),
        "threejs" | "three" => Some(STACK_THREEJS_CSV),
        "jetpack-compose" | "compose" => Some(STACK_JETPACK_COMPOSE_CSV),
        _ => None,
    }
}

/// Score how well a CSV record matches the query keywords.
/// Returns number of keywords found across all fields.
fn score_record(record: &csv::StringRecord, keywords: &[String]) -> usize {
    let row_text: String = record.iter().collect::<Vec<_>>().join(" ").to_lowercase();
    keywords
        .iter()
        .filter(|kw| row_text.contains(kw.as_str()))
        .count()
}

/// Format a single CSV record as a readable key-value block.
fn format_record(headers: &csv::StringRecord, record: &csv::StringRecord) -> String {
    let mut parts = Vec::new();
    for (i, header) in headers.iter().enumerate() {
        if let Some(value) = record.get(i) {
            let value = value.trim();
            if !value.is_empty() && header != "No" {
                parts.push(format!("**{}**: {}", header, value));
            }
        }
    }
    parts.join("\n")
}

/// Search a CSV dataset for rows matching the query keywords.
fn search_csv(csv_data: &str, query: &str, max_results: usize) -> Vec<String> {
    let keywords: Vec<String> = query
        .to_lowercase()
        .split_whitespace()
        .map(|s| s.to_string())
        .collect();

    if keywords.is_empty() {
        return vec![];
    }

    let mut reader = csv::Reader::from_reader(Cursor::new(csv_data));
    let headers = match reader.headers() {
        Ok(h) => h.clone(),
        Err(_) => return vec![],
    };

    let mut scored: Vec<(usize, String)> = reader
        .records()
        .filter_map(|r| r.ok())
        .filter_map(|record| {
            let score = score_record(&record, &keywords);
            if score > 0 {
                Some((score, format_record(&headers, &record)))
            } else {
                None
            }
        })
        .collect();

    // Sort by score descending
    scored.sort_by(|a, b| b.0.cmp(&a.0));
    scored.truncate(max_results);
    scored.into_iter().map(|(_, text)| text).collect()
}

/// Search design knowledge across a specific domain or stack.
///
/// Returns a formatted markdown string with results.
pub fn search(
    query: &str,
    domain: Option<&str>,
    stack: Option<&str>,
    max_results: usize,
) -> String {
    let max_results = if max_results == 0 { 5 } else { max_results };

    // Stack search
    if let Some(stack_name) = stack {
        if let Some(csv_data) = stack_csv(stack_name) {
            let results = search_csv(csv_data, query, max_results);
            if results.is_empty() {
                return format!(
                    "No results found for \"{}\" in stack \"{}\".",
                    query, stack_name
                );
            }
            let mut output = format!(
                "## Stack: {} — {} result(s) for \"{}\"\n\n",
                stack_name,
                results.len(),
                query
            );
            for (i, result) in results.iter().enumerate() {
                output.push_str(&format!("### Result {}\n{}\n\n---\n\n", i + 1, result));
            }
            return output;
        } else {
            return format!(
                "Unknown stack \"{}\". Available: react, nextjs, vue, svelte, angular, flutter, react-native, swiftui, shadcn, html-tailwind, astro, nuxtjs, nuxt-ui, laravel, threejs, jetpack-compose.",
                stack_name
            );
        }
    }

    // Domain search
    if let Some(domain_name) = domain {
        if let Some(csv_data) = domain_csv(domain_name) {
            let results = search_csv(csv_data, query, max_results);
            if results.is_empty() {
                return format!(
                    "No results found for \"{}\" in domain \"{}\".",
                    query, domain_name
                );
            }
            let mut output = format!(
                "## Domain: {} — {} result(s) for \"{}\"\n\n",
                domain_name,
                results.len(),
                query
            );
            for (i, result) in results.iter().enumerate() {
                output.push_str(&format!("### Result {}\n{}\n\n---\n\n", i + 1, result));
            }
            return output;
        } else {
            return format!(
                "Unknown domain \"{}\". Available: style, color, typography, ux, product, chart, landing, reasoning, icon.",
                domain_name
            );
        }
    }

    // No domain or stack specified — search across key domains
    let key_domains = [
        ("product", PRODUCTS_CSV),
        ("style", STYLES_CSV),
        ("color", COLORS_CSV),
        ("typography", TYPOGRAPHY_CSV),
        ("ux", UX_GUIDELINES_CSV),
    ];

    let mut output = format!("## Design Knowledge Search: \"{}\"\n\n", query);
    let mut total = 0;

    for (name, csv_data) in &key_domains {
        let results = search_csv(csv_data, query, 3);
        if !results.is_empty() {
            total += results.len();
            output.push_str(&format!(
                "### {} — {} match(es)\n\n",
                name,
                results.len()
            ));
            for result in &results {
                output.push_str(&format!("{}\n\n---\n\n", result));
            }
        }
    }

    if total == 0 {
        format!(
            "No results found for \"{}\". Try specifying a domain (style, color, typography, ux, product, chart, landing) or stack (react, nextjs, vue, etc.).",
            query
        )
    } else {
        output
    }
}

/// List all available domains and stacks.
pub fn list_domains() -> String {
    "## Available Domains\n\n\
     | Domain | Description | Example Keywords |\n\
     |--------|-------------|------------------|\n\
     | `style` | UI styles, effects, visual approaches | glassmorphism, minimalism, dark mode, brutalism |\n\
     | `color` | Color palettes by product type | saas, ecommerce, healthcare, fintech |\n\
     | `typography` | Font pairings and type systems | elegant, playful, professional, modern |\n\
     | `ux` | UX best practices and anti-patterns | animation, accessibility, navigation, loading |\n\
     | `product` | Product type recommendations | saas, ecommerce, portfolio, dashboard |\n\
     | `chart` | Chart types and data visualization | trend, comparison, timeline, funnel |\n\
     | `landing` | Landing page structure and CTAs | hero, testimonial, pricing, social-proof |\n\
     | `reasoning` | Design reasoning rules | (product type keywords) |\n\
     | `icon` | Icon guidelines and best practices | svg, accessibility, sizing |\n\n\
     ## Available Stacks\n\n\
     | Stack | Focus |\n\
     |-------|-------|\n\
     | `react` | Components, hooks, state, performance |\n\
     | `nextjs` | SSR, routing, optimization |\n\
     | `vue` | Composition API, reactivity |\n\
     | `svelte` | Stores, transitions, compilation |\n\
     | `angular` | Modules, services, RxJS |\n\
     | `flutter` | Widgets, state management |\n\
     | `react-native` | Components, navigation, lists |\n\
     | `swiftui` | Views, modifiers, state |\n\
     | `shadcn` | Component patterns, theming |\n\
     | `html-tailwind` | Utility classes, responsive |\n\
     | `astro` | Islands, content collections |\n\
     | `nuxtjs` | Auto-imports, server routes |\n\
     | `nuxt-ui` | UI components, theming |\n\
     | `laravel` | Blade, Livewire |\n\
     | `threejs` | 3D scenes, WebGL |\n\
     | `jetpack-compose` | Composables, Material 3 |"
        .to_string()
}
