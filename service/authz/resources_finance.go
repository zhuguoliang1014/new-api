package authz

const ResourceFinance = "finance"

var (
	FinanceRead   = Permission{Resource: ResourceFinance, Action: ActionRead}
	FinanceWrite  = Permission{Resource: ResourceFinance, Action: ActionWrite}
	FinanceExport = Permission{Resource: ResourceFinance, Action: "export"}
	FinanceManage = Permission{Resource: ResourceFinance, Action: "manage"}
)

func init() {
	RegisterResource(ResourceDefinition{Resource: ResourceFinance, LabelKey: "Financial management", Actions: []ActionDefinition{
		{Action: ActionRead, LabelKey: "View financial records", DescriptionKey: "View financial records"},
		{Action: ActionWrite, LabelKey: "Maintain financial records", DescriptionKey: "Maintain financial records"},
		{Action: "export", LabelKey: "Export financial records", DescriptionKey: "Export financial records"},
		{Action: "manage", LabelKey: "Manage financial rules and imports", DescriptionKey: "Manage financial rules and imports"},
	}})
}
