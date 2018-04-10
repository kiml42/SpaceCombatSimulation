using Assets.Src.Database;

namespace Assets.Src.Menus
{
    public class Evolution1v1LoadList : GenericEvolutionLoadList
    {
        public void Start()
        {
            _handler = new EvolutionBrDatabaseHandler();
            GenericInitialisation();
        }
    }
}
