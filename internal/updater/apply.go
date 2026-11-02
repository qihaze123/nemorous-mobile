package updater

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"syscall"
)

// ApplyAndRestart atomically replaces the running executable and re-execs the
// new image. On success this function never returns: the process is replaced
// with the same PID, arguments and environment. On Unix the old executable may
// be renamed while running; the replacement is downloaded into the same
// directory so the final rename stays on one filesystem.
func ApplyAndRestart(exePath, newPath string) error {
	if runtime.GOOS == "windows" {
		return errors.New("Windows 暂不支持替换正在运行的程序")
	}
	exePath = filepath.Clean(exePath)
	if !filepath.IsAbs(exePath) || !filepath.IsAbs(newPath) {
		return errors.New("更新路径必须是绝对路径")
	}
	backup := exePath + ".old"
	_ = os.Remove(backup)
	if err := os.Rename(exePath, backup); err != nil {
		return fmt.Errorf("备份旧版本失败: %w", err)
	}
	if err := os.Rename(newPath, exePath); err != nil {
		_ = os.Rename(backup, exePath)
		return fmt.Errorf("替换新版本失败: %w", err)
	}
	args := append([]string{exePath}, os.Args[1:]...)
	if err := syscall.Exec(exePath, args, os.Environ()); err != nil {
		_ = os.Remove(exePath)
		_ = os.Rename(backup, exePath)
		return fmt.Errorf("重启新版本失败: %w", err)
	}
	return nil
}
