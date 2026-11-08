// Live binding shared by setup, phone sharing, and port management.
import { defaultPort } from './listener.js';
export let PORT = defaultPort();
export function setPort(port) { PORT = port; }
