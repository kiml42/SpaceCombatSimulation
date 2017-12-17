using Assets.Src.Interfaces;
using Assets.Src.ObjectManagement;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

public class SpawnTurret : MonoBehaviour, IKnowsEnemyTags
{
    public IKnowsEnemyTags EnemyTagSource;
    public bool TagChildren = false;

    #region EnemyTags
    public void AddEnemyTag(string newTag)
    {
        var tags = EnemyTags;
        tags.Add(newTag);
        EnemyTags = tags.Distinct().ToList();
    }

    public void SetEnemyTags(List<string> allEnemyTags)
    {
        EnemyTags = allEnemyTags;
    }

    public List<string> GetEnemyTags()
    {
        return EnemyTags;
    }

    public List<string> EnemyTags;
    #endregion

    public Transform TurretPrefab;

	// Use this for initialization
	void Start () {
        if(EnemyTagSource == null && transform.parent != null)
        {
            EnemyTagSource = transform.parent.GetComponent("IKnowsEnemyTags") as IKnowsEnemyTags;
        }

        if(EnemyTagSource != null)
        {
            EnemyTags = EnemyTagSource.GetEnemyTags();
        }

        var turret = Instantiate(TurretPrefab, transform.position, transform.rotation, transform);
        if(transform.parent != null)
        {
            turret.parent = transform.parent;

            turret.GetComponent<FixedJoint>().connectedBody = transform.parent.GetComponent<Rigidbody>();

            var renderer = transform.parent.GetComponent("Renderer") as Renderer;

            if (renderer != null)
            {
                //Debug.Log("has renderer");
                turret.transform.SetColor(renderer.material.color);
            }
        }
        turret.SendMessage("SetEnemyTags", EnemyTags);
        if (TagChildren) { turret.tag = tag; }


        Destroy(gameObject);
    }
}
