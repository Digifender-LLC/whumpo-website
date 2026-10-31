// Profiles run a file without arguments: this runs the same journey on local D1.
process.argv.push('--d1');await import('./brand-kits.mjs');
