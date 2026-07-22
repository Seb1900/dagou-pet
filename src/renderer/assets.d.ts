declare module "*.png?url" {
  const source: string;
  export default source;
}

declare module "*.md?raw" {
  const source: string;
  export default source;
}
