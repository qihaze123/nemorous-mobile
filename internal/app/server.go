package app

import (
	"encoding/json"
	"io"
	"log"
	"net/http"
	"strconv"
)

// Version is stamped into the health response and the UI footer.
const Version = "0.3.4"

// APIHandler returns the routed, authenticated JSON API.
func (a *App) APIHandler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", a.handleHealth)
	mux.HandleFunc("POST /api/pair", a.handlePair)
	mux.HandleFunc("GET /api/workspace", a.authed(a.handleWorkspace))
	mux.HandleFunc("GET /api/workspaces", a.authed(a.handleWorkspaces))
	mux.HandleFunc("GET /api/workspaces/repos", a.authed(a.handleWorkspaceRepos))
	mux.HandleFunc("POST /api/workspaces", a.authed(a.handleAddWorkspace))
	mux.HandleFunc("POST /api/workspaces/select", a.authed(a.handleSelectWorkspace))
	mux.HandleFunc("POST /api/workspaces/visibility", a.authed(a.handleWorkspaceVisibility))
	mux.HandleFunc("GET /api/repos/{id}", a.authed(a.handleRepo))
	mux.HandleFunc("GET /api/repos/{id}/diff", a.authed(a.handleDiff))
	mux.HandleFunc("POST /api/repos/{id}/stage", a.authed(a.handleStage))
	mux.HandleFunc("POST /api/repos/{id}/unstage", a.authed(a.handleUnstage))
	mux.HandleFunc("POST /api/repos/{id}/discard", a.authed(a.handleDiscard))
	mux.HandleFunc("POST /api/repos/{id}/commit", a.authed(a.handleCommit))
	mux.HandleFunc("POST /api/repos/{id}/push", a.authed(a.handlePush))
	mux.HandleFunc("POST /api/repos/{id}/pull", a.authed(a.handlePull))
	mux.HandleFunc("POST /api/repos/{id}/checkout", a.authed(a.handleCheckout))
	mux.HandleFunc("POST /api/repos/{id}/stash", a.authed(a.handleStash))
	mux.HandleFunc("POST /api/repos/{id}/stash/pop", a.authed(a.handleStashPop))
	mux.HandleFunc("POST /api/repos/{id}/undo", a.authed(a.handleUndo))
	mux.HandleFunc("GET /api/repos/{id}/commits", a.authed(a.handleCommits))
	mux.HandleFunc("GET /api/repos/{id}/commits/{hash}", a.authed(a.handleCommitDetail))
	mux.HandleFunc("GET /api/repos/{id}/files", a.authed(a.handleFiles))
	mux.HandleFunc("GET /api/repos/{id}/file", a.authed(a.handleFile))
	mux.HandleFunc("GET /api/commits", a.authed(a.handleAllCommits))
	mux.HandleFunc("GET /api/branches", a.authed(a.handleBranches))
	mux.HandleFunc("GET /api/presets", a.authed(a.handlePresets))
	mux.HandleFunc("POST /api/presets", a.authed(a.handleSavePreset))
	mux.HandleFunc("POST /api/presets/delete", a.authed(a.handleDeletePreset))
	mux.HandleFunc("POST /api/presets/apply", a.authed(a.handleApplyPreset))
	mux.HandleFunc("GET /api/search", a.authed(a.handleSearch))
	mux.HandleFunc("POST /api/batch", a.authed(a.handleBatch))
	mux.HandleFunc("POST /api/batch/commit", a.authed(a.handleBatchCommit))
	mux.HandleFunc("POST /api/batch/stash", a.authed(a.handleBatchStash))
	mux.HandleFunc("POST /api/batch/stash/pop", a.authed(a.handleBatchStashPop))
	mux.HandleFunc("GET /api/pair/code", a.authed(a.handlePairCode))
	mux.HandleFunc("GET /api/devices", a.authed(a.handleDevices))
	mux.HandleFunc("DELETE /api/devices/{id}", a.authed(a.handleRevokeDevice))
	mux.HandleFunc("GET /api/events", a.authed(a.handleEvents))
	return withCommon(mux)
}

// authed accepts a paired-device cookie or the optional API bearer token.
func (a *App) authed(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		info, ok := a.authenticate(r)
		if !ok {
			writeError(w, http.StatusUnauthorized, "设备未配对或会话已失效，请用配对码连接")
			return
		}
		// A cookie is ambient authority; require same-origin writes so a
		// malicious site cannot drive the console with the user's session.
		if info.Cookie && r.Method != http.MethodGet && r.Method != http.MethodHead && !sameOrigin(r) {
			writeError(w, http.StatusForbidden, "跨站请求被拒绝")
			return
		}
		next(w, r)
	}
}

func withCommon(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		defer func() {
			if rec := recover(); rec != nil {
				log.Printf("panic: %v", rec)
				writeError(w, http.StatusInternalServerError, "服务内部错误")
			}
		}()
		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func (a *App) fail(w http.ResponseWriter, err error) {
	writeError(w, http.StatusBadRequest, err.Error())
}

func decode(r *http.Request, v any) error {
	defer r.Body.Close()
	dec := json.NewDecoder(io.LimitReader(r.Body, 1<<20))
	if err := dec.Decode(v); err != nil {
		return err
	}
	return nil
}

func (a *App) handleHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "version": Version})
}

func (a *App) handleWorkspace(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, a.Workspace(r.Context()))
}

func (a *App) handleWorkspaces(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, a.Workspaces(r.Context()))
}

func (a *App) handleWorkspaceRepos(w http.ResponseWriter, r *http.Request) {
	res, err := a.WorkspaceRepos(r.Context(), r.URL.Query().Get("path"))
	if err != nil {
		a.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, res)
}

func (a *App) handleAddWorkspace(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Path   string `json:"path"`
		Create bool   `json:"create"`
	}
	if err := decode(r, &req); err != nil {
		a.fail(w, err)
		return
	}
	res, err := a.AddWorkspace(r.Context(), req.Path, req.Create)
	if err != nil {
		a.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, res)
}

func (a *App) handleSelectWorkspace(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Path string `json:"path"`
	}
	if err := decode(r, &req); err != nil {
		a.fail(w, err)
		return
	}
	res, err := a.SelectWorkspace(r.Context(), req.Path)
	if err != nil {
		a.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, res)
}

func (a *App) handleWorkspaceVisibility(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Path   string `json:"path"`
		Repo   string `json:"repo"`
		Hidden bool   `json:"hidden"`
	}
	if err := decode(r, &req); err != nil {
		a.fail(w, err)
		return
	}
	res, err := a.SetRepoHiddenAt(r.Context(), req.Path, req.Repo, req.Hidden)
	if err != nil {
		a.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, res)
}

func (a *App) handleRepo(w http.ResponseWriter, r *http.Request) {
	detail, err := a.RepoDetail(r.Context(), r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, detail)
}

func (a *App) handleDiff(w http.ResponseWriter, r *http.Request) {
	staged := r.URL.Query().Get("staged") == "1" || r.URL.Query().Get("staged") == "true"
	res, err := a.Diff(r.Context(), r.PathValue("id"), r.URL.Query().Get("path"), staged, r.URL.Query().Get("context") == "full")
	if err != nil {
		a.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, res)
}

func (a *App) handleStage(w http.ResponseWriter, r *http.Request) {
	var req pathsReq
	if err := decode(r, &req); err != nil {
		a.fail(w, err)
		return
	}
	if err := a.Stage(r.Context(), r.PathValue("id"), req.Paths); err != nil {
		a.fail(w, err)
		return
	}
	a.hub.notify()
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (a *App) handleUnstage(w http.ResponseWriter, r *http.Request) {
	var req pathsReq
	if err := decode(r, &req); err != nil {
		a.fail(w, err)
		return
	}
	if err := a.Unstage(r.Context(), r.PathValue("id"), req.Paths); err != nil {
		a.fail(w, err)
		return
	}
	a.hub.notify()
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (a *App) handleDiscard(w http.ResponseWriter, r *http.Request) {
	var req pathsReq
	if err := decode(r, &req); err != nil {
		a.fail(w, err)
		return
	}
	if err := a.Discard(r.Context(), r.PathValue("id"), req.Paths, req.Confirm); err != nil {
		a.fail(w, err)
		return
	}
	a.hub.notify()
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (a *App) handleCommit(w http.ResponseWriter, r *http.Request) {
	var req commitReq
	if err := decode(r, &req); err != nil {
		a.fail(w, err)
		return
	}
	hash, err := a.Commit(r.Context(), r.PathValue("id"), req.Message, req.Paths, req.Amend)
	if err != nil {
		a.fail(w, err)
		return
	}
	a.hub.notify()
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "hash": hash})
}

func (a *App) handlePush(w http.ResponseWriter, r *http.Request) {
	res, err := a.Push(r.Context(), r.PathValue("id"))
	if err != nil {
		a.fail(w, err)
		return
	}
	a.hub.notify()
	writeJSON(w, http.StatusOK, res)
}

func (a *App) handlePull(w http.ResponseWriter, r *http.Request) {
	res, err := a.Pull(r.Context(), r.PathValue("id"))
	if err != nil {
		a.fail(w, err)
		return
	}
	a.hub.notify()
	writeJSON(w, http.StatusOK, res)
}

func (a *App) handleCheckout(w http.ResponseWriter, r *http.Request) {
	var req checkoutReq
	if err := decode(r, &req); err != nil {
		a.fail(w, err)
		return
	}
	res, err := a.Checkout(r.Context(), r.PathValue("id"), req.Branch, req.Create)
	if err != nil {
		a.fail(w, err)
		return
	}
	a.hub.notify()
	writeJSON(w, http.StatusOK, res)
}

func logFilterFromQuery(r *http.Request) LogFilter {
	q := r.URL.Query()
	limit, _ := strconv.Atoi(q.Get("limit"))
	days, _ := strconv.Atoi(q.Get("days"))
	return LogFilter{
		Limit:         limit,
		Repos:         q["repo"],
		Query:         q.Get("q"),
		Regex:         q.Get("regex") == "1",
		CaseSensitive: q.Get("case") == "1",
		Branch:        q.Get("branch"),
		Author:        q.Get("author"),
		Mine:          q.Get("mine") == "1",
		Path:          q.Get("path"),
		Days:          days,
	}
}

func (a *App) handleAllCommits(w http.ResponseWriter, r *http.Request) {
	commits, err := a.Logs(r.Context(), logFilterFromQuery(r))
	if err != nil {
		a.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, commits)
}

func (a *App) handleStash(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Message string `json:"message"`
	}
	if err := decode(r, &req); err != nil {
		a.fail(w, err)
		return
	}
	res, err := a.Stash(r.Context(), r.PathValue("id"), req.Message)
	if err != nil {
		a.fail(w, err)
		return
	}
	if res.Status == "OK" {
		a.hub.notify()
	}
	writeJSON(w, http.StatusOK, res)
}

func (a *App) handleStashPop(w http.ResponseWriter, r *http.Request) {
	res, err := a.StashPop(r.Context(), r.PathValue("id"))
	if err != nil {
		a.fail(w, err)
		return
	}
	if res.Status == "OK" {
		a.hub.notify()
	}
	writeJSON(w, http.StatusOK, res)
}

func (a *App) handleUndo(w http.ResponseWriter, r *http.Request) {
	res, err := a.UndoLastCommit(r.Context(), r.PathValue("id"))
	if err != nil {
		a.fail(w, err)
		return
	}
	a.hub.notify()
	writeJSON(w, http.StatusOK, res)
}

func (a *App) handleCommits(w http.ResponseWriter, r *http.Request) {
	f := logFilterFromQuery(r)
	f.Repos = []string{r.PathValue("id")}
	commits, err := a.Logs(r.Context(), f)
	if err != nil {
		a.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, commits)
}

func (a *App) handleBranches(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, a.Branches(r.Context()))
}

func (a *App) handlePresets(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, a.Presets())
}

func (a *App) handleSavePreset(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name     string            `json:"name"`
		Branches map[string]string `json:"branches"`
	}
	if err := decode(r, &req); err != nil {
		a.fail(w, err)
		return
	}
	preset, err := a.SavePreset(req.Name, req.Branches)
	if err != nil {
		a.fail(w, err)
		return
	}
	a.hub.notify()
	writeJSON(w, http.StatusOK, preset)
}

func (a *App) handleDeletePreset(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name string `json:"name"`
	}
	if err := decode(r, &req); err != nil {
		a.fail(w, err)
		return
	}
	ok, err := a.DeletePreset(req.Name)
	if err != nil {
		a.fail(w, err)
		return
	}
	if !ok {
		writeError(w, http.StatusNotFound, "预设不存在")
		return
	}
	a.hub.notify()
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (a *App) handleApplyPreset(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name string `json:"name"`
	}
	if err := decode(r, &req); err != nil {
		a.fail(w, err)
		return
	}
	results, err := a.ApplyPreset(r.Context(), req.Name)
	if err != nil {
		a.fail(w, err)
		return
	}
	a.hub.notify()
	writeJSON(w, http.StatusOK, map[string]any{"results": results})
}

func (a *App) handleCommitDetail(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Query().Get("path")
	var detail CommitDetail
	var err error
	if path != "" {
		detail, err = a.CommitFileDetail(r.Context(), r.PathValue("id"), r.PathValue("hash"), path)
	} else if r.URL.Query().Get("context") == "full" {
		detail, err = a.CommitDetailFull(r.Context(), r.PathValue("id"), r.PathValue("hash"))
	} else {
		detail, err = a.CommitDetail(r.Context(), r.PathValue("id"), r.PathValue("hash"))
	}
	if err != nil {
		a.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, detail)
}

func (a *App) handleFiles(w http.ResponseWriter, r *http.Request) {
	files, err := a.Files(r.Context(), r.PathValue("id"))
	if err != nil {
		a.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, files)
}

func (a *App) handleFile(w http.ResponseWriter, r *http.Request) {
	fc, err := a.File(r.Context(), r.PathValue("id"), r.URL.Query().Get("path"), r.URL.Query().Get("rev"))
	if err != nil {
		a.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, fc)
}

func (a *App) handleSearch(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	ids := q["repo"]
	res, err := a.Search(r.Context(), q.Get("q"), q.Get("mode"), q.Get("regex") == "1", q.Get("case") == "1", ids)
	if err != nil {
		a.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, res)
}

func (a *App) handleBatch(w http.ResponseWriter, r *http.Request) {
	var req batchReq
	if err := decode(r, &req); err != nil {
		a.fail(w, err)
		return
	}
	results, err := a.Batch(r.Context(), req.Action, req.Repos, req.Branch, req.Create)
	if err != nil {
		a.fail(w, err)
		return
	}
	a.hub.notify()
	writeJSON(w, http.StatusOK, map[string]any{"results": results})
}

func (a *App) handleBatchStash(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Repos   []string `json:"repos"`
		Message string   `json:"message"`
	}
	if err := decode(r, &req); err != nil {
		a.fail(w, err)
		return
	}
	results, err := a.BatchStash(r.Context(), req.Repos, req.Message)
	if err != nil {
		a.fail(w, err)
		return
	}
	a.hub.notify()
	writeJSON(w, http.StatusOK, map[string]any{"results": results})
}

func (a *App) handleBatchStashPop(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Repos []string `json:"repos"`
	}
	if err := decode(r, &req); err != nil {
		a.fail(w, err)
		return
	}
	results, err := a.BatchStashPop(r.Context(), req.Repos)
	if err != nil {
		a.fail(w, err)
		return
	}
	a.hub.notify()
	writeJSON(w, http.StatusOK, map[string]any{"results": results})
}

func (a *App) handleBatchCommit(w http.ResponseWriter, r *http.Request) {
	var req batchCommitReq
	if err := decode(r, &req); err != nil {
		a.fail(w, err)
		return
	}
	results, err := a.BatchCommit(r.Context(), req.Repos, req.Message, req.Push)
	if err != nil {
		a.fail(w, err)
		return
	}
	a.hub.notify()
	writeJSON(w, http.StatusOK, map[string]any{"results": results})
}

type pathsReq struct {
	Paths   []string `json:"paths"`
	Confirm bool     `json:"confirm"`
}

type commitReq struct {
	Message string   `json:"message"`
	Paths   []string `json:"paths"`
	Amend   bool     `json:"amend"`
}

type checkoutReq struct {
	Branch string `json:"branch"`
	Create bool   `json:"create"`
}

type batchReq struct {
	Action string   `json:"action"`
	Repos  []string `json:"repos"`
	Branch string   `json:"branch"`
	Create bool     `json:"create"`
}

type batchCommitReq struct {
	Message string         `json:"message"`
	Push    bool           `json:"push"`
	Repos   []CommitTarget `json:"repos"`
}
