// The command that runs another of the package's scripts, with the package manager that
// started this one (npm or Yarn). npm needs `--` before the script's own arguments; Yarn
// passes them straight through.
const usesYarn = (process.env.npm_config_user_agent ?? '').startsWith('yarn');

export function packageScript(name: string, args = ''): string {
  const rest = args.trim();
  if (usesYarn) return rest ? `yarn ${name} ${rest}` : `yarn ${name}`;
  return rest ? `npm run ${name} -- ${rest}` : `npm run ${name}`;
}
