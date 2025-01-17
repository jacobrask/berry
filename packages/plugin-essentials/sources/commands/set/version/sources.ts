import {WorkspaceRequiredError}                                                       from '@berry/cli';
import {CommandContext, Configuration, MessageName, Project, StreamReport, execUtils} from '@berry/core';
import {Filename, PortablePath, ppath, toPortablePath, xfs}                           from '@berry/fslib';
import {Command}                                                                      from 'clipanion';
import {tmpdir}                                                                       from 'os';

import {setVersion}                                                                   from '../version';

const CLONE_WORKFLOW = ({repository, branch}: {repository: string, branch: string}) => [
  [`git`, `clone`, repository, `.`],
  [`git`, `checkout`, branch],
];

const UPDATE_WORKFLOW = ({branch}: {branch: string}) => [
  [`git`, `fetch`, `origin`],
  [`git`, `reset`, `--hard`],
  [`git`, `clean`, `-dfx`],
  [`git`, `checkout`, `origin/${branch}`],
  [`git`, `clean`, `-dfx`],
];

const BUILD_WORKFLOW = [
  [`yarn`, `build:cli`],
];

// eslint-disable-next-line arca/no-default-export
export default class SetVersionCommand extends Command<CommandContext> {
  @Command.String(`--path`)
  installPath?: string;

  @Command.String(`--repository`)
  repository: string = `git@github.com:yarnpkg/berry`;

  @Command.String(`--branch`)
  branch: string = `master`;

  static usage = Command.Usage({
    description: `build Yarn from master`,
    details: `
      This command will clone the Yarn repository into a temporary folder, then build it. The resulting bundle will then be copied into the local project.
    `,
    examples: [[
      `Build Yarn from master`,
      `yarn set version from sources`,
    ]],
  });

  @Command.Path(`set`, `version`, `from`, `sources`)
  async execute() {
    const configuration = await Configuration.find(this.context.cwd, this.context.plugins);
    const {project, workspace} = await Project.find(configuration, this.context.cwd);

    if (!workspace)
      throw new WorkspaceRequiredError(this.context.cwd);

    const target = typeof this.installPath !== `undefined`
      ? ppath.resolve(this.context.cwd, toPortablePath(this.installPath))
      : ppath.resolve(toPortablePath(tmpdir()), `berry` as Filename);

    const report = await StreamReport.start({
      configuration,
      stdout: this.context.stdout,
    }, async (report: StreamReport) => {
      await xfs.mkdirpPromise(target);

      let workflow;
      if (xfs.existsSync(target)) {
        report.reportInfo(MessageName.UNNAMED, `Fetching the latest commits`);
        workflow = UPDATE_WORKFLOW(this);
      } else {
        report.reportInfo(MessageName.UNNAMED, `Cloning the remote repository`);
        workflow = CLONE_WORKFLOW(this);
      }

      report.reportSeparator();

      for (const [fileName, ...args] of workflow) {
        await execUtils.pipevp(fileName, args, {
          cwd: target,
          stdin: this.context.stdin,
          stdout: this.context.stdout,
          stderr: this.context.stderr,
          strict: true,
        });
      }

      report.reportSeparator();
      report.reportInfo(MessageName.UNNAMED, `Building a fresh bundle`);
      report.reportSeparator();

      for (const [fileName, ...args] of BUILD_WORKFLOW) {
        await execUtils.pipevp(fileName, args, {
          cwd: target,
          stdin: this.context.stdin,
          stdout: this.context.stdout,
          stderr: this.context.stderr,
          strict: true,
        });
      }

      report.reportSeparator();

      const bundlePath = ppath.resolve(target, `packages/berry-cli/bundles/berry.js` as PortablePath);
      const bundleBuffer = await xfs.readFilePromise(bundlePath);

      await setVersion(project, `berry`, bundleBuffer, {
        report,
      });
    });

    return report.exitCode();
  }
}
