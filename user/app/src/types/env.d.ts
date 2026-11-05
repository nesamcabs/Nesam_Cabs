/// <reference types="expo/types" />

// Metro resolves image requires to an asset id.
declare module '*.png' {
  const asset: number;
  export default asset;
}
