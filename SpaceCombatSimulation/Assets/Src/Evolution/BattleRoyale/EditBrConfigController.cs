using UnityEngine.UI;

namespace Assets.Src.Evolution.BattleRoyale
{
    public class EditBrConfigController : EditBaseConfig
    {
        public InputField NumberOfTeams;
        public InputField DeathScoreMultiplier;
        public InputField SurvivalBonus;

        private EvolutionBrConfig _loaded;

        public EvolutionBrConfig ReadControls()
        {
            _loaded.NumberOfCombatants = int.Parse(NumberOfTeams.text);
            _loaded.DeathScoreMultiplier = int.Parse(DeathScoreMultiplier.text);
            _loaded.SurvivalBonus = int.Parse(SurvivalBonus.text);

            return _loaded;
        }

        public override void PopulateControls(EvolutionConfig config)
        {
            _loaded = config.BrConfig;

            NumberOfTeams.text = _loaded.NumberOfCombatants.ToString();
            DeathScoreMultiplier.text = _loaded.DeathScoreMultiplier.ToString();
            SurvivalBonus.text = _loaded.SurvivalBonus.ToString();
        }
    } 
}
