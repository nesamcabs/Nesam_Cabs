// Execute the real admin service source in Node against a supplied emulator SDK.
const fs = require('fs'), path = require('path'), { createRequire } = require('module');
const ts = require('typescript');
const root = path.resolve(__dirname, '../../admin');
const external = createRequire(path.join(root, 'package.json'));
module.exports = function adminServiceLoader(firebase) {
  const cache = new Map();
  function load(relative) {
    const filename = path.resolve(root, relative);
    if (!filename.startsWith(root + path.sep)) throw Error('Admin source only');
    if (filename === path.join(root, 'src/services/firebase.ts')) return firebase;
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} }; cache.set(filename, module);
    const source = fs.readFileSync(filename, 'utf8').replace(/import\.meta\.env/g, '({})');
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    function requireLocal(id) {
      if (!id.startsWith('.')) return external(id);
      const base = path.resolve(path.dirname(filename), id);
      const file = [base+'.ts',base+'.tsx',base+'/index.ts',base+'/index.tsx',base].find(f=>fs.existsSync(f)&&fs.statSync(f).isFile());
      if (!file) throw Error('Unresolved '+id+' from '+filename);
      return load(path.relative(root,file));
    }
    new Function('exports','require','module','__filename','__dirname',code)(module.exports,requireLocal,module,filename,path.dirname(filename));
    return module.exports;
  }
  return load;
};
