#!/bin/bash
set -e
DOTFILES="$HOME/dotfiles"
CONFIG="$HOME/.config"
PI_AGENT_DIR="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"

link() {
  ln -sf "$DOTFILES/$1" "$CONFIG/$2"
}

#Fish
mkdir -p "$CONFIG/fish"
link fish/config.fish fish/config.fish

# Starship
link starship/starship.toml starship.toml

# Kitty
mkdir -p "$CONFIG/kitty"
link kitty/kitty.conf kitty/kitty.conf
link kitty/kitty.app.png kitty.kitty.app.png

# Pi extensions and subagents
mkdir -p "$PI_AGENT_DIR/extensions/subagent" "$PI_AGENT_DIR/agents"
ln -sf "$DOTFILES/pi/extensions/project-references.ts" "$PI_AGENT_DIR/extensions/project-references.ts"
ln -sf "$DOTFILES/pi/extensions/subagent/index.ts" "$PI_AGENT_DIR/extensions/subagent/index.ts"
ln -sf "$DOTFILES/pi/extensions/subagent/agents.ts" "$PI_AGENT_DIR/extensions/subagent/agents.ts"
ln -sf "$DOTFILES/pi/extensions/subagent/README.md" "$PI_AGENT_DIR/extensions/subagent/README.md"
for agent in scout planner reviewer worker; do
  ln -sf "$DOTFILES/pi/agents/$agent.md" "$PI_AGENT_DIR/agents/$agent.md"
done

echo "Done!"
