export function parsePrepTasks(markdown) {
  const tasks = [];
  let current = null;

  String(markdown || "").replace(/\r\n/g, "\n").split("\n").forEach((line) => {
    const taskMatch = line.match(/^[-*+]\s+\[[ xX]\]\s+(.+)$/);
    if (taskMatch) {
      current = { details: [], index: tasks.length, title: taskMatch[1].trim() };
      tasks.push(current);
      return;
    }
    if (current) current.details.push(line.replace(/^ {2}/, ""));
  });

  return tasks.map((task) => ({ ...task, details: task.details.join("\n").trim() }));
}

export function prepDetailValue(details, label) {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(details || "").match(new RegExp(`^-\\s+${escapedLabel}:\\s*(.+)$`, "im"));
  return match ? match[1].trim() : "";
}
