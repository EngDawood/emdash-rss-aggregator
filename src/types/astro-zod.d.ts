/**
 * Ambient type declarations for `astro/zod` peer dependency.
 */

declare module "astro/zod" {
	export { z } from "zod";
	export type { ZodType, ZodObject, ZodString, ZodNumber, ZodBoolean, ZodEnum, ZodArray, ZodOptional, ZodDefault } from "zod";
}
