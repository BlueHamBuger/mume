import { spawn } from "child_process";
import * as path from "path";
import { getExtensionConfigPath } from "./mume";
import PlantUMLServerTask from "./puml-server";
import { extensionDirectoryPath } from "./utility";

const PlantUMLJarPath = path.resolve(
  extensionDirectoryPath,
  "./dependencies/plantuml/plantuml.jar",
);

/**
 * key is fileDirectoryPath, value is PlantUMLTask
 */
const TASKS: { [key: string]: PlantUMLTask | PlantUMLServerTask } = {};

/**
 * key is fileDirectoryPath, value is String
 */
const CHUNKS: { [key: string]: string } = {};

/**
 * key is fileDirectoryPath, value is Array
 */
const CALLBACKS: { [key: string]: ((result: string) => void)[] } = {};

class PlantUMLTask {
  private fileDirectoryPath: string;
  private chunks: string;
  private callbacks: ((result: string) => void)[];
  private task;

  constructor(fileDirectoryPath: string) {
    this.fileDirectoryPath = fileDirectoryPath;
    this.chunks = CHUNKS[this.fileDirectoryPath] || "";
    this.callbacks = CALLBACKS[this.fileDirectoryPath] || [];
    this.task = null;

    this.startTask();
  }

  public generateSVG(content: string): Promise<string> {
    return new Promise((resolve, reject) => {
      this.callbacks.push(resolve);
      this.task.stdin.write(content + "\n");
    });
  }

  private startTask() {
    this.task = spawn("java", [
      "-Djava.awt.headless=true",
      "-Dfile.encoding=UTF-8",
      "-Dplantuml.include.path=" +
        [this.fileDirectoryPath, getExtensionConfigPath()].join(path.delimiter),
      "-jar",
      PlantUMLJarPath,
      // '-graphvizdot', 'exe'
      "-pipe",
      "-tsvg",
      "-charset",
      "UTF-8",
    ]);

    this.task.stdout.on("data", (chunk) => {
      let data = chunk.toString();
      this.chunks += data;
      if (
        this.chunks.trimRight().endsWith("</svg>") &&
        this.chunks.match(/<svg/g).length ===
          this.chunks.match(/<\/svg>/g).length
      ) {
        data = this.chunks;
        this.chunks = ""; // clear CHUNKS
        const diagrams = data.split("<?xml ");
        diagrams.forEach((diagram) => {
          if (diagram.length) {
            const callback = this.callbacks.shift();
            if (callback) {
              let str = diagram.startsWith("<") ? diagram : "<?xml " + diagram;
              let regex = /<[^<]+title="([^"]+)"[^>]*>/g;
              let matches = str.matchAll(regex);
              let str_fragment = [];
              let former_idx = 0;
              for (const match of matches) {
                let new_idx = match.index + match[0].length;
                str_fragment.push(str.substring(former_idx, new_idx));
                former_idx = new_idx;
                str_fragment.push("<title>" + match[1] + "</title>");
              }
              str_fragment.push(str.substring(former_idx));
              callback(str_fragment.join(""));
            }
          }
        });
      }
    });

    this.task.on("error", (err) => {
      // Return error object to rendered doc
      this.callbacks.forEach((cb) => cb(JSON.stringify(err)));
      this.closeSelf();
    });
    this.task.on("exit", () => this.closeSelf());
  }

  /**
   * stop this.task and store this.chunks and this.callbacks
   */
  private closeSelf() {
    TASKS[this.fileDirectoryPath] = null;
    CHUNKS[this.fileDirectoryPath] = this.chunks;
    CALLBACKS[this.fileDirectoryPath] = this.callbacks;
  }
}

// async call
export async function render(
  content: string,
  fileDirectoryPath: string = "",
  serverURL: string = "",
): Promise<string> {
  content = content.trim();
  // ' @mume_file_directory_path:/fileDirectoryPath
  // fileDirectoryPath
  const match = content.match(/^'\s@mume_file_directory_path:(.+)$/m);
  if (match) {
    fileDirectoryPath = match[1];
  }

  const startMatch = content.match(/^\@start(.+?)\s+/m);
  if (startMatch) {
    if (!content.match(new RegExp(`^\\@end${startMatch[1]}`, "m"))) {
      content = "@startuml\n@enduml"; // error
    }
  } else {
    content = `@startuml
${content}
@enduml`;
  }

  if (!TASKS[fileDirectoryPath]) {
    if (!!serverURL) {
      TASKS[fileDirectoryPath] = new PlantUMLServerTask(serverURL);
    } else {
      // init `plantuml.jar` task
      TASKS[fileDirectoryPath] = new PlantUMLTask(fileDirectoryPath);
    }
  }

  return await TASKS[fileDirectoryPath].generateSVG(content);
}
