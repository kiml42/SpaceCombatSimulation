using Assets.Src.Interfaces;
using Assets.Src.Targeting;
using UnityEngine;

public class VirtualTarget : MonoBehaviour, ITarget
{
    public string Team => null;

    public Transform Transform => this.transform;

    public Rigidbody Rigidbody => null;

    public ShipType Type => ShipType.Turret;

    public bool NavigationalTarget => false;

    public bool AtackTarget => false;

    public void SetTeam(string newTeam)
    {
        throw new System.NotImplementedException();
    }

    public void SetTeamSource(ITarget teamSource)
    {
        throw new System.NotImplementedException();
    }
}