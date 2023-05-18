import { preprocessCSS, resolveConfig, transformWithEsbuild } from 'vite';
import { mapToRelative, removeLangSuffix } from './utils/sourcemaps';

const supportedStyleLangs = ['css', 'less', 'sass', 'scss', 'styl', 'stylus', 'postcss', 'sss'];
const supportedScriptLangs = ['ts'];

export const lang_sep = '.vite-preprocess.';

/**
 * @param {{
 *   script?: boolean;
 *   style?: boolean | import('vite').InlineConfig | import('vite').ResolvedConfig;
 * }} [opts]
 * @returns
 */
export function vitePreprocess(opts) {
	/** @type {import('svelte/types/compiler/preprocess').PreprocessorGroup} */
	const preprocessor = {};
	if (opts?.script !== false) {
		preprocessor.script = viteScript().script;
	}
	if (opts?.style !== false) {
		const styleOpts = typeof opts?.style == 'object' ? opts?.style : undefined;
		preprocessor.style = viteStyle(styleOpts).style;
	}
	return preprocessor;
}

/**
 * @returns {{ script: import('svelte/types/compiler/preprocess').Preprocessor }}
 */
function viteScript() {
	return {
		/** @type {import('svelte/types/compiler/preprocess').Preprocessor} */
		async script({ attributes, content, filename = '' }) {
			const lang = /** @type {string} */ (attributes.lang);
			if (!supportedScriptLangs.includes(lang)) return;
			const { code, map } = await transformWithEsbuild(content, filename, {
				loader: /** @type {import('vite').ESBuildOptions['loader']} */ (lang),
				target: 'esnext',
				tsconfigRaw: {
					compilerOptions: {
						// svelte typescript needs this flag to work with type imports
						importsNotUsedAsValues: 'preserve',
						preserveValueImports: true
					}
				}
			});

			mapToRelative(map, filename);

			return {
				code,
				map
			};
		}
	};
}

/**
 * @param {import('vite').InlineConfig | import('vite').ResolvedConfig} config
 * @returns {{ style: import('svelte/types/compiler/preprocess').Preprocessor }}
 */
function viteStyle(config = {}) {
	/** @type {CssTransform} */
	let transform;
	/** @type {import('svelte/types/compiler/preprocess').Preprocessor} */
	const style = async ({ attributes, content, filename = '' }) => {
		const lang = /** @type {string} */ (attributes.lang);
		if (!supportedStyleLangs.includes(lang)) return;
		if (!transform) {
			/** @type {import('vite').ResolvedConfig} */
			let resolvedConfig;
			// @ts-expect-error special prop added if running in v-p-s
			if (style.__resolvedConfig) {
				// @ts-expect-error
				resolvedConfig = style.__resolvedConfig;
			} else if (isResolvedConfig(config)) {
				resolvedConfig = config;
			} else {
				resolvedConfig = await resolveConfig(
					config,
					process.env.NODE_ENV === 'production' ? 'build' : 'serve'
				);
			}
			transform = getCssTransformFn(resolvedConfig);
		}
		const suffix = `${lang_sep}${lang}`;
		const moduleId = `${filename}${suffix}`;
		const { code, map, deps } = await transform(content, moduleId);
		removeLangSuffix(map, suffix);
		mapToRelative(map, filename);
		const dependencies = deps ? Array.from(deps).filter((d) => !d.endsWith(suffix)) : undefined;
		return {
			code,
			map: map ?? undefined,
			dependencies
		};
	};
	// @ts-expect-error tag so can be found by v-p-s
	style.__resolvedConfig = null;
	return { style };
}

/**
 * @typedef {(code: string, filename: string ) => Promise<{ code: string; map?: any; deps?: Set<string> }>} CssTransform
 */

/**
 * @param {import('vite').ResolvedConfig} config
 * @returns {CssTransform}
 */
function getCssTransformFn(config) {
	return async (code, filename) => {
		return preprocessCSS(code, filename, config);
	};
}

/**
 * @param {any} config
 * @returns {config is import('vite').ResolvedConfig}
 */
function isResolvedConfig(config) {
	return !!config.inlineConfig;
}
