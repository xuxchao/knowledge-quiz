#!/usr/bin/env node

/**
 * 换行符统一转换工具
 * 将项目中所有未被 Git 忽略的文本文件的换行符转换为 LF 格式
 * 
 * 特性：
 * - 使用 git ls-files 获取未被忽略的文件列表
 * - 通过检测 NUL 字节识别二进制文件
 * - 安全写入模式：先写入临时文件，验证后再重命名
 * - 支持命令行参数指定目录或文件
 * - 保留文件原始权限和属性
 * - 详细的转换日志输出
 */

const { spawnSync, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

class LineEndingConverter {
  /**
   * 创建换行符转换工具实例
   * @param {Object} options - 配置选项
   * @param {string[]} options.targets - 指定的目标文件或目录
   * @param {boolean} options.dryRun - 仅预览，不实际转换
   * @param {boolean} options.verbose - 详细日志输出
   */
  constructor(options = {}) {
    this.targets = options.targets || [];
    this.dryRun = options.dryRun || false;
    this.verbose = options.verbose || false;
    this.processedCount = 0;
    this.skippedCount = 0;
    this.errorCount = 0;
    this.startTime = Date.now();
  }

  /**
   * 获取所有未被 Git 忽略的文件列表
   * @returns {string[]} 文件路径数组
   */
  getGitTrackedFiles() {
    try {
      const baseArgs = ['--cached', '--others', '--exclude-standard', '-z'];
      const args = this.targets.length > 0
        ? baseArgs.concat(this.targets)
        : baseArgs;

      const result = spawnSync('git', ['ls-files', ...args], {
        cwd: process.cwd(),
        encoding: 'buffer',
        stdio: ['pipe', 'pipe', 'pipe']
      });

      if (result.status !== 0) {
        const error = result.stderr.toString().trim();
        throw new Error(`git ls-files failed: ${error}`);
      }

      const output = result.stdout;
      const files = [];
      let start = 0;

      for (let i = 0; i < output.length; i++) {
        if (output[i] === 0) {
          const filePath = output.slice(start, i).toString('utf8');
          if (filePath) {
            files.push(filePath);
          }
          start = i + 1;
        }
      }

      return files;
    } catch (err) {
      this.logError(`获取 Git 跟踪文件失败: ${err.message}`);
      return [];
    }
  }

  /**
   * 判断文件是否为二进制文件
   * 通过检测文件内容中是否包含 NUL 字节来判断
   * @param {string} filePath - 文件路径
   * @returns {boolean} 是否为二进制文件
   */
  isBinaryFile(filePath) {
    try {
      const stats = fs.statSync(filePath);
      const maxReadSize = 1024 * 8;
      const readSize = Math.min(stats.size, maxReadSize);
      const buffer = Buffer.alloc(readSize);
      const fd = fs.openSync(filePath, 'r');
      fs.readSync(fd, buffer, 0, readSize, 0);
      fs.closeSync(fd);

      for (let i = 0; i < buffer.length; i++) {
        if (buffer[i] === 0) {
          return true;
        }
      }
      return false;
    } catch (err) {
      this.logError(`检测文件类型失败 ${filePath}: ${err.message}`);
      return true;
    }
  }

  /**
   * 检测文件中的换行符类型
   * @param {string} content - 文件内容
   * @returns {Object} 换行符类型统计
   */
  detectLineEndings(content) {
    const hasCRLF = /\r\n/.test(content);
    const hasCR = /\r(?!\n)/.test(content);
    const hasLF = /\n(?!\r)/.test(content);

    return {
      hasCRLF,
      hasCR,
      hasLF,
      needsConversion: hasCRLF || hasCR
    };
  }

  /**
   * 将换行符转换为 LF
   * @param {string} content - 原始文件内容
   * @returns {string} 转换后的内容
   */
  convertToLF(content) {
    return content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  }

  /**
   * 安全写入文件
   * 先写入临时文件，验证后再重命名覆盖原文件
   * @param {string} filePath - 目标文件路径
   * @param {string} content - 要写入的内容
   * @param {fs.Stats} originalStats - 原始文件的 stat 信息
   * @returns {boolean} 是否成功
   */
  safeWriteFile(filePath, content, originalStats) {
    try {
      const tempPath = `${filePath}.tmp-lf-convert`;

      fs.writeFileSync(tempPath, content, { encoding: 'utf8' });

      const tempStats = fs.statSync(tempPath);
      if (tempStats.size !== Buffer.byteLength(content, 'utf8')) {
        fs.unlinkSync(tempPath);
        throw new Error('临时文件写入不完整');
      }

      fs.chmodSync(tempPath, originalStats.mode);
      fs.utimesSync(tempPath, originalStats.atime, originalStats.mtime);

      fs.renameSync(tempPath, filePath);

      return true;
    } catch (err) {
      const tempPath = `${filePath}.tmp-lf-convert`;
      try {
        fs.unlinkSync(tempPath);
      } catch (e) {
      }
      throw err;
    }
  }

  /**
   * 处理单个文件
   * @param {string} filePath - 文件路径
   */
  processFile(filePath) {
    try {
      if (this.isBinaryFile(filePath)) {
        if (this.verbose) {
          this.logInfo(`[跳过] 二进制文件: ${filePath}`);
        }
        this.skippedCount++;
        return;
      }

      const originalStats = fs.statSync(filePath);
      const content = fs.readFileSync(filePath, 'utf8');
      const lineEndings = this.detectLineEndings(content);

      if (!lineEndings.needsConversion) {
        if (this.verbose) {
          this.logInfo(`[跳过] 已是 LF 格式: ${filePath}`);
        }
        this.skippedCount++;
        return;
      }

      const newContent = this.convertToLF(content);

      if (this.dryRun) {
        this.logInfo(`[预览] 待转换: ${filePath} (CRLF:${lineEndings.hasCRLF}, CR:${lineEndings.hasCR})`);
        this.processedCount++;
        return;
      }

      this.safeWriteFile(filePath, newContent, originalStats);
      this.logInfo(`[转换成功] ${filePath} (CRLF:${lineEndings.hasCRLF}, CR:${lineEndings.hasCR})`);
      this.processedCount++;
    } catch (err) {
      this.logError(`[转换失败] ${filePath}: ${err.message}`);
      this.errorCount++;
    }
  }

  /**
   * 执行转换流程
   */
  run() {
    this.logInfo('=== 开始换行符转换 ===');
    this.logInfo(`工作目录: ${process.cwd()}`);
    this.logInfo(`模式: ${this.dryRun ? '预览模式' : '实际转换模式'}`);
    if (this.targets.length > 0) {
      this.logInfo(`指定目标: ${this.targets.join(', ')}`);
    }

    const files = this.getGitTrackedFiles();

    if (files.length === 0) {
      this.logInfo('未找到需要处理的文件');
      return;
    }

    this.logInfo(`共发现 ${files.length} 个文件待处理`);

    files.forEach((file) => {
      this.processFile(file);
    });

    this.printSummary();
  }

  /**
   * 打印转换摘要
   */
  printSummary() {
    const duration = ((Date.now() - this.startTime) / 1000).toFixed(2);
    this.logInfo('');
    this.logInfo('=== 转换完成 ===');
    this.logInfo(`总文件数: ${this.processedCount + this.skippedCount + this.errorCount}`);
    this.logInfo(`已转换: ${this.processedCount}`);
    this.logInfo(`已跳过: ${this.skippedCount}`);
    this.logInfo(`转换失败: ${this.errorCount}`);
    this.logInfo(`耗时: ${duration} 秒`);
  }

  /**
   * 输出信息日志
   * @param {string} message - 日志消息
   */
  logInfo(message) {
    console.log(message);
  }

  /**
   * 输出错误日志
   * @param {string} message - 错误消息
   */
  logError(message) {
    console.error(`[错误] ${message}`);
  }
}

/**
 * 解析命令行参数
 * @returns {Object} 解析后的选项
 */
function parseArgs() {
  const options = {
    targets: [],
    dryRun: false,
    verbose: false
  };

  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];

    if (arg.startsWith('-')) {
      if (arg.startsWith('--')) {
        switch (arg) {
          case '--dry-run':
            options.dryRun = true;
            break;
          case '--verbose':
            options.verbose = true;
            break;
          case '--help':
            printHelp();
            process.exit(0);
            break;
          default:
            console.error(`未知选项: ${arg}`);
            printHelp();
            process.exit(1);
        }
      } else {
        for (let j = 1; j < arg.length; j++) {
          const char = arg[j];
          switch (char) {
            case 'd':
              options.dryRun = true;
              break;
            case 'v':
              options.verbose = true;
              break;
            case 'h':
              printHelp();
              process.exit(0);
              break;
            default:
              console.error(`未知选项: -${char}`);
              printHelp();
              process.exit(1);
          }
        }
      }
    } else {
      options.targets.push(arg);
    }
  }

  return options;
}

/**
 * 打印帮助信息
 */
function printHelp() {
  const help = `
换行符转换工具 - 将项目文件换行符统一转换为 LF 格式

用法: node scripts/convert-line-endings.js [选项] [文件/目录...]

选项:
  -d, --dry-run    预览模式，仅显示待转换文件，不实际修改
  -v, --verbose    详细模式，显示所有处理的文件（包括跳过的）
  -h, --help       显示此帮助信息

示例:
  # 转换整个项目
  node scripts/convert-line-endings.js

  # 仅预览，不实际转换
  node scripts/convert-line-endings.js -d

  # 转换指定目录
  node scripts/convert-line-endings.js src/

  # 转换指定文件
  node scripts/convert-line-endings.js package.json README.md

  # 详细模式 + 预览
  node scripts/convert-line-endings.js -dv src/

说明:
  - 自动排除 .gitignore 中指定的文件和目录
  - 自动跳过二进制文件
  - 保留文件原始权限和时间戳
  - 安全写入：先写入临时文件，验证后再覆盖原文件
  `;

  console.log(help);
}

/**
 * 主函数
 */
function main() {
  if (!fs.existsSync('.git')) {
    console.error('错误: 当前目录不是 Git 仓库');
    process.exit(1);
  }

  const options = parseArgs();
  const converter = new LineEndingConverter(options);
  converter.run();
}

if (require.main === module) {
  main();
}

module.exports = LineEndingConverter;
