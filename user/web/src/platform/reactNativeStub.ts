// Type-only stand-in for the React Native modules that ../app/src/config/firebase.ts
// imports. The bundler replaces that file with ./firebase.ts, so none of this runs.
export const Platform = { OS: 'web' as string };
const AsyncStorage = {};
export default AsyncStorage;
