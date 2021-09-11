using UnityEngine.UI;


namespace Assets.Src.Evolution
{
    public class EditMatchConfigController : EditBaseConfig
    {
        public InputField MatchTimeout;
        public InputField WinnerPollPeriod;
        public InputField InitialRange;
        public InputField InitialSpeed;
        public InputField RandomInitialSpeed;
        public InputField CompetitorsPerTeam;
        public InputField AllowedModules;
        public InputField Budget;

        public InputField InSphereRandomisationRadius;
        public InputField OnSphereRandomisationRadius;

        private MatchConfig _loaded;

        public override void PopulateControls(EvolutionConfig config)
        {
            _loaded = config.MatchConfig;

            MatchTimeout.text = _loaded.MatchTimeout.ToString();
            WinnerPollPeriod.text = _loaded.WinnerPollPeriod.ToString();
            InitialRange.text = _loaded.InitialRange.ToString();
            InitialSpeed.text = _loaded.InitialSpeed.ToString();
            RandomInitialSpeed.text = _loaded.RandomInitialSpeed.ToString();
            CompetitorsPerTeam.text = _loaded.CompetitorsPerTeam.ToString();
            AllowedModules.text = _loaded.AllowedModulesString;
            Budget.text = _loaded.Budget.ToString();
        }

        public MatchConfig ReadControls()
        {
            _loaded = _loaded ?? new MatchConfig();

            _loaded.MatchTimeout = float.Parse(MatchTimeout.text);
            _loaded.WinnerPollPeriod = float.Parse(WinnerPollPeriod.text);
            _loaded.InitialRange = float.Parse(InitialRange.text);
            _loaded.InitialSpeed = float.Parse(InitialSpeed.text);
            _loaded.RandomInitialSpeed = float.Parse(RandomInitialSpeed.text);
            _loaded.CompetitorsPerTeam = int.Parse(CompetitorsPerTeam.text);
            _loaded.AllowedModulesString = AllowedModules.text;
            _loaded.Budget = float.Parse(Budget.text);

            return _loaded;
        }
    }
}
