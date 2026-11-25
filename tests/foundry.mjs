// Foundry core's common code from the workspace's source drop, as test globals.
import "../../../foundry-source/common/primitives/_module.mjs";
import * as abstract from "../../../foundry-source/common/abstract/_module.mjs";
import * as data from "../../../foundry-source/common/data/_module.mjs";
import * as utils from "../../../foundry-source/common/utils/_module.mjs";

globalThis.foundry = { abstract, data, utils };
globalThis.logger = { debug() {}, info() {}, log() {}, warn() {}, error() {} };
