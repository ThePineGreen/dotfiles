#!/bin/bash
set -e
DOTFILES="$HOME/dotfiles"
CONFIG="$HOME/.config"

link() {
  ln -sf "$DOTFILES/$1" "$CONFIG/$2"
}

# Starship
link starship/starship.toml starship.toml

# Kitty
mkdir -p "$CONFIG/kitty"
link kitty/kitty.conf kitty/kitty.conf
link kitty/kitty.app.png kitty/kitty.app.png

echo "Done!"
