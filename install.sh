#!/bin/bash
set -e
DOTFILES="$HOME/dotfiles"
CONFIG="$HOME/.config"

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
link kitty/kitty.app.png kitty/kitty.app.png

echo "Done!"
