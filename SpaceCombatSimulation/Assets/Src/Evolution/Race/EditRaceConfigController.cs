using UnityEngine.UI;

namespace Assets.Src.Evolution.Race
{
    public class EditRaceConfigController : EditBaseConfig
    {
        public InputField RaceGoalObject;
        public InputField RaceMaxDistance;
        public InputField RaceScoreMultiplier;

        private EvolutionRaceConfig _loaded;

        public EvolutionRaceConfig ReadControls()
        {
            _loaded.RaceGoalObject = int.Parse(RaceGoalObject.text);
            _loaded.RaceMaxDistance = int.Parse(RaceMaxDistance.text);
            _loaded.RaceScoreMultiplier = int.Parse(RaceScoreMultiplier.text);

            return _loaded;
        }

        public override void PopulateControls(EvolutionConfig config)
        {
            _loaded = config.RaceConfig;

            RaceGoalObject.text = _loaded.RaceGoalObject.ToString();
            RaceMaxDistance.text = _loaded.RaceMaxDistance.ToString();
            RaceScoreMultiplier.text = _loaded.RaceScoreMultiplier.ToString();
        }
    }
}
