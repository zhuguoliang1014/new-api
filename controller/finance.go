package controller

import (
	"encoding/csv"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func financeFailure(c *gin.Context, err error) {
	var invalid model.FinanceValidationError
	if errors.As(err, &invalid) {
		common.ApiErrorStatus(c, http.StatusBadRequest, common.NewMessage(invalid.Error()))
	} else if errors.Is(err, gorm.ErrRecordNotFound) {
		common.ApiErrorStatus(c, http.StatusNotFound, common.NewMessage("Financial record not found"))
	} else {
		common.ApiErrorStatus(c, http.StatusInternalServerError, common.NewMessage("Unable to process financial records"))
	}
}

func financeDecode(c *gin.Context, input any) bool {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 4<<20)
	if err := common.DecodeJson(c.Request.Body, input); err != nil {
		common.ApiErrorStatus(c, 400, common.NewMessage("Invalid financial request"))
		return false
	}
	return true
}

func financeID(c *gin.Context) (int, bool) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorStatus(c, 400, common.NewMessage("Invalid financial record ID"))
		return 0, false
	}
	return id, true
}

func financeFilter(c *gin.Context) (model.FinanceFilter, bool) {
	month := time.Now().In(time.FixedZone("Asia/Shanghai", 8*60*60)).Format("2006-01")
	f := model.FinanceFilter{From: c.DefaultQuery("from", month), To: c.DefaultQuery("to", month), Kind: c.Query("kind"), Search: c.Query("search"), Source: c.Query("source"), Category: c.Query("category"), Payer: c.Query("payer"), IncludeVoided: c.Query("include_voided") == "true"}
	f.Page, _ = strconv.Atoi(c.DefaultQuery("page", "1"))
	f.PageSize = 50
	if !model.FinanceMonthValid(f.From) || !model.FinanceMonthValid(f.To) || f.From > f.To || f.Page < 1 || f.Page > 100000 || len(f.Search) > 200 {
		common.ApiErrorStatus(c, 400, common.NewMessage("Invalid financial date range"))
		return f, false
	}
	start, _ := time.Parse("2006-01", f.From)
	end, _ := time.Parse("2006-01", f.To)
	if end.After(start.AddDate(5, 0, 0)) {
		common.ApiErrorStatus(c, 400, common.NewMessage("Select a financial period of at most five years"))
		return f, false
	}
	return f, true
}

func GetFinanceReport(c *gin.Context) {
	f, ok := financeFilter(c)
	if !ok {
		return
	}
	report, err := model.GetFinanceReport(f.From, f.To)
	if err != nil {
		financeFailure(c, err)
		return
	}
	common.ApiSuccess(c, report)
}

func ListFinanceEntries(c *gin.Context) {
	f, ok := financeFilter(c)
	if !ok {
		return
	}
	rows, total, err := model.ListFinanceEntries(f)
	if err != nil {
		financeFailure(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"items": rows, "total": total, "page": f.Page, "page_size": f.PageSize})
}

func SyncFinanceIncome(c *gin.Context) {
	added, err := model.SyncFinanceIncome(c.GetInt("id"))
	if err != nil {
		financeFailure(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"added": added})
}

func SaveFinanceEntry(c *gin.Context) {
	var input model.FinanceInput
	if !financeDecode(c, &input) {
		return
	}
	id := 0
	if c.Param("id") != "" {
		var ok bool
		id, ok = financeID(c)
		if !ok {
			return
		}
	}
	entry, err := model.SaveFinanceEntry(id, c.GetInt("id"), input)
	if err != nil {
		financeFailure(c, err)
		return
	}
	common.ApiSuccess(c, entry)
}

func VoidFinanceEntry(c *gin.Context) {
	id, ok := financeID(c)
	if !ok {
		return
	}
	var input struct {
		Version int    `json:"version"`
		Reason  string `json:"reason"`
	}
	if !financeDecode(c, &input) {
		return
	}
	if err := model.VoidFinanceEntry(id, c.GetInt("id"), input.Version, input.Reason); err != nil {
		financeFailure(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

func ReconcileFinanceEntry(c *gin.Context) {
	id, ok := financeID(c)
	if !ok {
		return
	}
	var input struct {
		Version int    `json:"version"`
		Amount  int64  `json:"amount_cents"`
		Fee     int64  `json:"fee_cents"`
		Date    string `json:"date"`
		Reason  string `json:"reason"`
	}
	if !financeDecode(c, &input) {
		return
	}
	if err := model.ReconcileFinanceEntry(id, c.GetInt("id"), input.Version, input.Amount, input.Fee, input.Date, input.Reason); err != nil {
		financeFailure(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

func AddFinanceRule(c *gin.Context) {
	var input model.FinanceRule
	if !financeDecode(c, &input) {
		return
	}
	if err := model.AddFinanceRule(input, c.GetInt("id")); err != nil {
		financeFailure(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

func SaveFinanceCategory(c *gin.Context) {
	var input struct {
		Name    string `json:"name"`
		Enabled bool   `json:"enabled"`
	}
	if !financeDecode(c, &input) {
		return
	}
	id := 0
	if c.Param("id") != "" {
		var ok bool
		id, ok = financeID(c)
		if !ok {
			return
		}
	}
	if err := model.SaveFinanceCategory(id, c.GetInt("id"), input.Name, input.Enabled); err != nil {
		financeFailure(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

func SetFinancePeriod(c *gin.Context) {
	var input struct {
		Month  string `json:"month"`
		Locked bool   `json:"locked"`
		Reason string `json:"reason"`
	}
	if !financeDecode(c, &input) {
		return
	}
	if err := model.SetFinancePeriod(input.Month, input.Locked, c.GetInt("id"), input.Reason); err != nil {
		financeFailure(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

func GetFinanceEntryDetails(c *gin.Context) {
	id, ok := financeID(c)
	if !ok {
		return
	}
	var entry model.FinanceEntry
	if err := model.DB.First(&entry, id).Error; err != nil {
		financeFailure(c, err)
		return
	}
	audits := []model.FinanceAudit{}
	attachments := []model.FinanceAttachment{}
	if err := model.DB.Where("entry_id = ?", id).Order("id DESC").Limit(200).Find(&audits).Error; err != nil {
		financeFailure(c, err)
		return
	}
	if err := model.DB.Omit("content").Where("entry_id = ?", id).Find(&attachments).Error; err != nil {
		financeFailure(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"entry": entry, "audits": audits, "attachments": attachments})
}

func UploadFinanceAttachment(c *gin.Context) {
	id, ok := financeID(c)
	if !ok {
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, (3<<20)+8192)
	file, header, err := c.Request.FormFile("file")
	if err != nil {
		common.ApiErrorStatus(c, 400, common.NewMessage("Select a receipt image or PDF under 3 MB"))
		return
	}
	defer file.Close()
	if c.Request.MultipartForm != nil {
		defer c.Request.MultipartForm.RemoveAll()
	}
	data, err := io.ReadAll(io.LimitReader(file, (3<<20)+1))
	if err != nil || len(data) > 3<<20 {
		common.ApiErrorStatus(c, 400, common.NewMessage("Select a receipt image or PDF under 3 MB"))
		return
	}
	contentType := http.DetectContentType(data)
	switch contentType {
	case "image/png", "image/jpeg", "image/webp", "application/pdf":
	default:
		common.ApiErrorStatus(c, 400, common.NewMessage("Select a receipt image or PDF under 3 MB"))
		return
	}
	attachment, err := model.AddFinanceAttachment(id, c.GetInt("id"), filepath.Base(header.Filename), contentType, data)
	if err != nil {
		financeFailure(c, err)
		return
	}
	common.ApiSuccess(c, attachment)
}

func DownloadFinanceAttachment(c *gin.Context) {
	id, ok := financeID(c)
	if !ok {
		return
	}
	var attachment model.FinanceAttachment
	if err := model.DB.First(&attachment, id).Error; err != nil {
		financeFailure(c, err)
		return
	}
	c.Header("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": attachment.Name}))
	c.Header("X-Content-Type-Options", "nosniff")
	c.Data(200, attachment.MIME, attachment.Content)
}

func PreviewFinanceImport(c *gin.Context) {
	var input struct {
		Rows []model.FinanceInput `json:"rows"`
	}
	if !financeDecode(c, &input) {
		return
	}
	preview, err := model.PreviewFinanceImport(input.Rows)
	if err != nil {
		financeFailure(c, err)
		return
	}
	common.ApiSuccess(c, preview)
}

func CommitFinanceImport(c *gin.Context) {
	var input struct {
		Rows []model.FinanceInput `json:"rows"`
		Hash string               `json:"hash"`
	}
	if !financeDecode(c, &input) {
		return
	}
	added, err := model.CommitFinanceImport(input.Rows, input.Hash, c.GetInt("id"))
	if err != nil {
		financeFailure(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"added": added})
}

// Prefix text which spreadsheet programs might interpret as formulas.
func financeCSVText(s string) string {
	trimmed := strings.TrimLeft(s, " \t\r\n")
	if trimmed != "" && strings.ContainsRune("=+-@", rune(trimmed[0])) {
		return "'" + s
	}
	return s
}

func ExportFinanceCSV(c *gin.Context) {
	f, ok := financeFilter(c)
	if !ok {
		return
	}
	if c.Query("view") == "summary" {
		report, err := model.GetFinanceReport(f.From, f.To)
		if err != nil {
			financeFailure(c, err)
			return
		}
		var buffer strings.Builder
		buffer.WriteString("\uFEFF")
		w := csv.NewWriter(&buffer)
		_ = w.Write([]string{"month", "net_income_cny", "payment_fees_cny", "expenses_cny", "customer_refunds_cny", "supplier_refunds_cny", "fee_refunds_cny", "cash_surplus_cny", "historical_net", "estimated_fee_count", "excluded_payment_count"})
		for _, summary := range append(report.Months, report.Summary) {
			month := summary.Month
			if month == "" {
				month = "TOTAL"
			}
			fee := financeCSVAmount(summary.FeeCents)
			if summary.HistoricalNet {
				fee = "not fully itemized"
			}
			_ = w.Write([]string{month, financeCSVAmount(summary.NetIncomeCents), fee, financeCSVAmount(summary.ExpenseCents), financeCSVAmount(summary.CustomerRefundCents), financeCSVAmount(summary.SupplierRefundCents), financeCSVAmount(summary.FeeRefundCents), financeCSVAmount(summary.BalanceCents), strconv.FormatBool(summary.HistoricalNet), strconv.Itoa(summary.EstimatedFees), strconv.Itoa(summary.Unresolved)})
		}
		w.Flush()
		c.Header("Content-Disposition", "attachment; filename=finance-summary-"+f.From+"-"+f.To+".csv")
		c.Header("X-Content-Type-Options", "nosniff")
		c.Data(200, "text/csv; charset=utf-8", []byte(buffer.String()))
		return
	}
	// One bounded SELECT gives the export a consistent statement snapshot.
	rows, err := model.ExportFinanceEntries(f)
	if err != nil {
		financeFailure(c, err)
		return
	}
	var buffer strings.Builder
	buffer.WriteString("\uFEFF")
	w := csv.NewWriter(&buffer)
	_ = w.Write([]string{"id", "month", "date", "kind", "original_currency_amount", "fee_cny", "net_income_cny", "currency", "fee_confirmed", "method", "source", "reference", "category", "counterparty", "payer", "note", "related_id", "voided"})
	for _, row := range rows {
		fee, net := "", ""
		if row.FeeCents != nil {
			fee = financeCSVAmount(*row.FeeCents)
		}
		if row.Currency == "CNY" {
			if row.Kind == "historical_income" {
				net = financeCSVAmount(row.AmountCents)
			} else if row.Kind == "income" && row.FeeCents != nil {
				net = financeCSVAmount(row.AmountCents - *row.FeeCents)
			}
		}
		values := []string{strconv.Itoa(row.ID), row.Month, row.Date, row.Kind, financeCSVAmount(row.AmountCents), fee, net, row.Currency, strconv.FormatBool(row.FeeConfirmed), row.Method, row.Source, row.SourceRef, row.Category, row.Counterparty, row.Payer, row.Note, strconv.Itoa(row.RelatedID), strconv.FormatBool(row.Voided)}
		for i, value := range values {
			values[i] = financeCSVText(value)
		}
		_ = w.Write(values)
	}
	w.Flush()
	c.Header("Content-Disposition", "attachment; filename=finance-"+f.From+"-"+f.To+".csv")
	c.Header("X-Content-Type-Options", "nosniff")
	c.Data(200, "text/csv; charset=utf-8", []byte(buffer.String()))
}

func financeCSVAmount(cents int64) string {
	sign := ""
	if cents < 0 {
		sign = "-"
		cents = -cents
	}
	return sign + strconv.FormatInt(cents/100, 10) + "." + fmt.Sprintf("%02d", cents%100)
}
