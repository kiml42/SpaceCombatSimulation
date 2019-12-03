using UnityEngine.UI;


namespace Assets.Src.Evolution.Drone
{
    public class EditDroneConfigController : EditBaseConfig
    {
        public InputField minDrones;
        public InputField DroneEscalation;
        public InputField MaxDrones;
        public InputField DronesList;

        public InputField DronesInSphereRandomRadius;
        public InputField DronesOnSphereRandomRadius;

        public InputField CompletionBonus;
        public InputField FlatKillBonus;
        public InputField KillScoreMultiplier;

        private EvolutionDroneConfig _loaded;

        public EvolutionDroneConfig ReadControls()
        {
            _loaded.MinDronesToSpawn = int.Parse(minDrones.text);
            _loaded.ExtraDromnesPerGeneration = float.Parse(DroneEscalation.text);
            _loaded.MaxDronesToSpawn = int.Parse(MaxDrones.text);
            _loaded.DronesString = DronesList.text;

            _loaded.DronesInSphereRandomRadius = int.Parse(DronesInSphereRandomRadius.text);
            _loaded.DronesOnSphereRandomRadius = int.Parse(DronesOnSphereRandomRadius.text);

            if (CompletionBonus != null)
                _loaded.CompletionBonus = int.Parse(CompletionBonus.text);
            if (FlatKillBonus != null)
                _loaded.FlatKillBonus = int.Parse(FlatKillBonus.text);
            if (KillScoreMultiplier != null)
                _loaded.KillScoreMultiplier = int.Parse(KillScoreMultiplier.text);

            return _loaded;
        }

        public override void PopulateControls(EvolutionConfig config)
        {
            _loaded = config.EvolutionDroneConfig ?? new EvolutionDroneConfig();
            minDrones.text = _loaded.MinDronesToSpawn.ToString();
            DroneEscalation.text = _loaded.ExtraDromnesPerGeneration.ToString();
            MaxDrones.text = _loaded.MaxDronesToSpawn.ToString();
            DronesList.text = _loaded.DronesString.ToString();

            DronesInSphereRandomRadius.text = _loaded.DronesInSphereRandomRadius.ToString();
            DronesOnSphereRandomRadius.text = _loaded.DronesOnSphereRandomRadius.ToString();

            if(CompletionBonus != null)
                CompletionBonus.text = _loaded.CompletionBonus.ToString();
            if (FlatKillBonus != null)
                FlatKillBonus.text = _loaded.FlatKillBonus.ToString();
            if (KillScoreMultiplier != null)
                KillScoreMultiplier.text = _loaded.KillScoreMultiplier.ToString();

        }
    }
}
