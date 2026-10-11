import tseslint from "typescript-eslint";

const config = tseslint.config(
  { ignores: [".next/**", "next-env.d.ts"] },
  ...tseslint.configs.recommended,
);
export default config;
